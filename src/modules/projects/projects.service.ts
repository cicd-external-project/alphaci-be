import { readFile } from 'node:fs/promises';

import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import yaml from 'js-yaml';

import { CatalogService } from '../catalog/catalog.service';
import { CiService } from '../ci/ci.service';
import { GithubService } from '../github/github.service';
import { ProjectDeploymentProvisioningService } from '../env-provisioning/project-deployment-provisioning.service';
import {
  ProjectsRepository,
  type ProvisionedProjectRow,
  type ProvisionedProjectStatus,
} from './projects.repository';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { SetupProjectDto } from './dto/setup-project.dto';
import {
  buildStagedWorkflowBundle,
  type StagedWorkflowFile,
  type WorkflowFileMetadata,
} from '../workflows/staged-workflow.builder';
import { buildProjectScaffold, defaultIncludeDocker } from './scaffold.builder';
import type {
  DeploymentProvisioningRequestDto,
  DeploymentProvisioningTargetDto,
} from './dto/create-project.dto';

// ─── Response shapes (match FE contracts exactly) ────────────────────────────

export interface CreateProjectResponse {
  id: string;
  repoFullName: string;
  repoUrl: string;
  status: 'provisioned';
  workflowPath: string;
  workflowFiles: WorkflowFileMetadata[];
  githubCommitSha: string;
  githubCommitUrl: string | null;
  projectTypeId: string;
  workflowRecipeId: string;
  additionalWorkflowPaths?: string[];
  secondaryRepoFullName?: string;
  secondaryRepoUrl?: string;
  deploymentProvisioning: DeploymentProvisioningResult;
}

export interface SetupProjectResponse {
  id: string;
  repoFullName: string;
  status: 'provisioned';
  workflowPath: string;
  workflowFiles: WorkflowFileMetadata[];
  githubCommitSha: string;
  githubCommitUrl: string | null;
  deploymentProvisioning: DeploymentProvisioningResult;
}

export interface DeploymentProvisioningResult {
  status: 'skipped' | 'completed' | 'partial' | 'failed';
  targets: Array<{
    slot: 'backend' | 'frontend' | 'standalone';
    provider: 'render' | 'vercel';
    status: 'created' | 'registered' | 'failed';
    deploymentTargetId: string | null;
    providerProjectId: string | null;
    providerProjectName: string | null;
    errorSummary: string | null;
    env: Array<{
      environment: 'test' | 'uat' | 'production';
      provisioned: Array<{ key: string; status: 'provisioned' }>;
      failed: Array<{ key: string; status: 'failed'; errorSummary: string }>;
    }>;
  }>;
}

export interface ProvisionedProject {
  id: string;
  repoFullName: string;
  templateId: string;
  serviceName: string;
  workflowPath: string;
  workflowFiles?: WorkflowFileMetadata[] | null;
  status: ProvisionedProjectStatus;
  githubCommitSha: string | null;
  githubCommitUrl: string | null;
  failureReason: string | null;
  repoUrl?: string | null;
  visibility?: string | null;
  repoShape?: string | null;
  projectTypeId?: string | null;
  workflowRecipeId?: string | null;
  projectOptions?: Record<string, unknown> | null;
}

export interface SyncProjectsResponse {
  orphaned: number;
  reachable: number;
  total: number;
}

export interface ProvisionedProjectsResponse {
  items: ProvisionedProject[];
}

// ─── GitHub Contents API response ────────────────────────────────────────────

interface GitHubContentsResponse {
  content: { html_url?: string };
  commit: { sha: string; html_url?: string };
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly githubService: GithubService,
    private readonly projectsRepository: ProjectsRepository,
    private readonly ciService: CiService,
    private readonly projectDeploymentProvisioningService: ProjectDeploymentProvisioningService,
  ) {}

  // ─── POST /projects ────────────────────────────────────────────────────────

  async createProject(
    userId: string,
    userLogin: string,
    accessToken: string | null,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    const provisioningToken = await this.resolveProvisioningToken(
      userId,
      accessToken,
    );

    if (dto.repoShape === 'microservices') {
      return this.createMicroservicesProject(
        userId,
        userLogin,
        provisioningToken,
        dto,
      );
    }

    if (dto.repoShape === 'multi-repo') {
      return this.createMultiRepoProject(
        userId,
        userLogin,
        provisioningToken,
        dto,
      );
    }

    // 1. Resolve templateId from projectTypeId + workflowRecipeId
    const templateId = this.resolveTemplateId(
      dto.projectTypeId,
      dto.workflowRecipeId,
    );

    // 2. Load template and build workflow YAML
    const { workflowFiles, outputFileName } = await this.buildWorkflowBundle(
      templateId,
      dto.serviceName,
      dto.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
      dto.outputFileName,
    );

    // 3. Create the GitHub repository (auto_init: true creates main branch)
    const { repoUrl, ownerLogin, repoName } =
      await this.githubService.createRepo(provisioningToken, {
        repoName: dto.repoName,
        private: dto.visibility === 'private',
      });

    const repoFullName = `${ownerLogin}/${repoName}`;

    // 3.5 Push scaffold + README to main so all downstream branches inherit them
    await this.pushStarterFiles(provisioningToken, ownerLogin, repoName, {
      projectName: dto.serviceName,
      stack: dto.projectTypeId,
      repoShape: dto.repoShape ?? 'standalone',
    });

    // 3.6 Push workflow YAML to main BEFORE creating branches so that test and
    // uat inherit the workflow files — GitHub Actions reads the YAML from the
    // branch being pushed to, so it must exist on those branches.
    const workflowPath = `.github/workflows/${outputFileName}`;
    const { commitSha, commitUrl } = await this.pushWorkflowFiles(
      provisioningToken,
      ownerLogin,
      repoName,
      workflowFiles,
    );

    // 4. Create uat and test branches from main (scaffold + workflow already present)
    for (const branch of ['uat', 'test'] as const) {
      await this.githubService.createBranch(
        provisioningToken,
        ownerLogin,
        repoName,
        branch,
        'main',
      );
    }

    // 5. Apply branch protection to all three branches
    for (const branch of ['test', 'uat', 'main'] as const) {
      await this.githubService.applyBranchProtection(
        provisioningToken,
        ownerLogin,
        repoName,
        branch,
      );
    }

    // 7. Persist
    const row = await this.projectsRepository.create({
      userId,
      repoFullName,
      templateId,
      serviceName: dto.serviceName,
      workflowPath,
      status: 'provisioned',
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
      repoUrl,
      visibility: dto.visibility,
      repoShape: dto.repoShape ?? null,
      projectTypeId: dto.projectTypeId,
      workflowRecipeId: dto.workflowRecipeId ?? null,
      projectOptions: {
        ...(dto.tests ? { tests: dto.tests } : {}),
        workflowFiles: this.workflowFileMetadata(workflowFiles),
      },
    });

    const ciToken = await this.ciService.issueProjectToken(row.id);
    await this.githubService.setActionsSecret(
      provisioningToken,
      ownerLogin,
      repoName,
      'CI_TOKEN',
      ciToken.token,
    );

    const deploymentProvisioning =
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: row.id,
        userId,
        repoFullName,
        request: dto.deploymentProvisioning,
      });

    return {
      id: row.id,
      repoFullName,
      repoUrl,
      status: 'provisioned',
      workflowPath,
      workflowFiles: this.workflowFileMetadata(workflowFiles),
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
      projectTypeId: dto.projectTypeId,
      workflowRecipeId: dto.workflowRecipeId ?? '',
      deploymentProvisioning,
    };
  }

  // ─── POST /projects (microservices shape) ─────────────────────────────────

  private async createMicroservicesProject(
    userId: string,
    _userLogin: string,
    accessToken: string,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    if (!dto.microservicesConfig) {
      throw new UnprocessableEntityException(
        'microservicesConfig is required for microservices shape',
      );
    }

    const { backend, frontend } = dto.microservicesConfig;

    // 1. Resolve template IDs for both slots
    const backendTemplateId = this.resolveTemplateId(
      backend.projectTypeId,
      backend.workflowRecipeId,
    );
    const frontendTemplateId = this.resolveTemplateId(
      frontend.projectTypeId,
      frontend.workflowRecipeId,
    );

    // 2. Build workflow YAML for both slots
    const {
      workflowFiles: backendWorkflowFiles,
      outputFileName: backendOutputFileName,
    } = await this.buildWorkflowBundle(
      backendTemplateId,
      backend.serviceName,
      backend.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
    );

    const {
      workflowFiles: frontendWorkflowFiles,
      outputFileName: frontendOutputFileName,
    } = await this.buildWorkflowBundle(
      frontendTemplateId,
      frontend.serviceName,
      frontend.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
    );

    // 3. Create the GitHub repository once
    const { repoUrl, ownerLogin, repoName } =
      await this.githubService.createRepo(accessToken, {
        repoName: dto.repoName,
        private: dto.visibility === 'private',
      });

    const repoFullName = `${ownerLogin}/${repoName}`;

    // 4. Push starter files to main so all subsequent branches inherit them
    await this.pushStarterFiles(accessToken, ownerLogin, repoName, {
      projectName: dto.repoName,
      stack: backend.projectTypeId,
      repoShape: 'microservices',
      backendServiceName: backend.serviceName,
      frontendStack: frontend.projectTypeId,
      frontendServiceName: frontend.serviceName,
    });

    // 5. Push backend workflow file to main
    const backendWorkflowPath =
      backendWorkflowFiles[0]?.path ??
      `.github/workflows/${backendOutputFileName}`;
    const { commitSha: backendCommitSha, commitUrl: backendCommitUrl } =
      await this.pushWorkflowFiles(
        accessToken,
        ownerLogin,
        repoName,
        backendWorkflowFiles,
      );

    // 6. Push frontend workflow file to main (wrapped: failure should not block backend)
    const frontendWorkflowPath =
      frontendWorkflowFiles[0]?.path ??
      `.github/workflows/${frontendOutputFileName}`;
    const additionalWorkflowPaths: string[] = [];
    let frontendPushResult:
      | { commitSha: string; commitUrl: string | null }
      | undefined;

    try {
      frontendPushResult = await this.pushWorkflowFiles(
        accessToken,
        ownerLogin,
        repoName,
        frontendWorkflowFiles,
      );
      additionalWorkflowPaths.push(
        ...frontendWorkflowFiles.map((file) => file.path),
      );
    } catch (err) {
      this.logger.warn(
        `Microservices project: frontend workflow push failed: ${String(err)}`,
      );
    }

    // 7. Create uat and test branches from main (now contains starter files + both workflows)
    for (const branch of ['uat', 'test'] as const) {
      await this.githubService.createBranch(
        accessToken,
        ownerLogin,
        repoName,
        branch,
        'main',
      );
    }

    // 8. Apply branch protection to all three branches once
    for (const branch of ['test', 'uat', 'main'] as const) {
      await this.githubService.applyBranchProtection(
        accessToken,
        ownerLogin,
        repoName,
        branch,
      );
    }

    // 9. Save backend DB row
    const backendRow = await this.projectsRepository.create({
      userId,
      repoFullName,
      templateId: backendTemplateId,
      serviceName: backend.serviceName,
      workflowPath: backendWorkflowPath,
      status: 'provisioned',
      githubCommitSha: backendCommitSha,
      githubCommitUrl: backendCommitUrl,
      repoUrl,
      visibility: dto.visibility,
      repoShape: dto.repoShape ?? null,
      projectTypeId: backend.projectTypeId,
      workflowRecipeId: backend.workflowRecipeId ?? null,
      projectOptions: {
        ...(dto.tests ? { tests: dto.tests } : {}),
        workflowFiles: this.workflowFileMetadata(backendWorkflowFiles),
      },
    });

    const ciToken = await this.ciService.issueProjectToken(backendRow.id);
    await this.githubService.setActionsSecret(
      accessToken,
      ownerLogin,
      repoName,
      'CI_TOKEN',
      ciToken.token,
    );

    const deploymentProvisioningResults: DeploymentProvisioningResult[] = [
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: backendRow.id,
        userId,
        repoFullName,
        request: this.filterDeploymentProvisioningRequest(
          dto.deploymentProvisioning,
          ['backend'],
        ),
      }),
    ];

    // 10. Save frontend DB row if the push succeeded
    if (frontendPushResult !== undefined) {
      try {
        const frontendRow = await this.projectsRepository.create({
          userId,
          repoFullName,
          templateId: frontendTemplateId,
          serviceName: frontend.serviceName,
          workflowPath: frontendWorkflowPath,
          status: 'provisioned',
          githubCommitSha: frontendPushResult.commitSha,
          githubCommitUrl: frontendPushResult.commitUrl,
          repoUrl,
          visibility: dto.visibility,
          repoShape: dto.repoShape ?? null,
          projectTypeId: frontend.projectTypeId,
          workflowRecipeId: frontend.workflowRecipeId ?? null,
          projectOptions: {
            workflowFiles: this.workflowFileMetadata(frontendWorkflowFiles),
          },
        });

        deploymentProvisioningResults.push(
          await this.projectDeploymentProvisioningService.provisionForProject({
            projectId: frontendRow.id,
            userId,
            repoFullName,
            request: this.filterDeploymentProvisioningRequest(
              dto.deploymentProvisioning,
              ['frontend'],
            ),
          }),
        );
      } catch (err) {
        this.logger.warn(
          `Microservices project: frontend DB row save failed: ${String(err)}`,
        );
      }
    }

    return {
      id: backendRow.id,
      repoFullName,
      repoUrl,
      status: 'provisioned',
      workflowPath: backendWorkflowPath,
      workflowFiles: this.workflowFileMetadata(backendWorkflowFiles),
      githubCommitSha: backendCommitSha,
      githubCommitUrl: backendCommitUrl,
      projectTypeId: backend.projectTypeId,
      workflowRecipeId: backend.workflowRecipeId ?? '',
      additionalWorkflowPaths,
      deploymentProvisioning: this.combineDeploymentProvisioningResults(
        deploymentProvisioningResults,
      ),
    };
  }

  // ─── POST /projects/setup ──────────────────────────────────────────────────

  async setupProject(
    userId: string,
    accessToken: string,
    dto: SetupProjectDto,
  ): Promise<SetupProjectResponse> {
    // 1. Build workflow YAML from the given templateId
    const { workflowFiles, outputFileName } = await this.buildWorkflowBundle(
      dto.templateId,
      dto.serviceName,
      dto.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
      dto.outputFileName,
      dto.enhancements,
    );

    // 2. Derive owner and repo from repoFullName (format: "owner/repo")
    const [owner, repo] = this.parseRepoFullName(dto.repoFullName);

    // 3. Push workflow file to the existing repo's default branch (main)
    const workflowPath =
      workflowFiles[0]?.path ?? `.github/workflows/${outputFileName}`;
    const { commitSha, commitUrl } = await this.pushWorkflowFiles(
      accessToken,
      owner,
      repo,
      workflowFiles,
    );

    // 4. Persist
    const row = await this.projectsRepository.create({
      userId,
      repoFullName: dto.repoFullName,
      templateId: dto.templateId,
      serviceName: dto.serviceName,
      workflowPath,
      status: 'provisioned',
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
      projectOptions: {
        workflowFiles: this.workflowFileMetadata(workflowFiles),
      },
    });

    const ciToken = await this.ciService.issueProjectToken(row.id);
    await this.githubService.setActionsSecret(
      accessToken,
      owner,
      repo,
      'CI_TOKEN',
      ciToken.token,
    );

    const deploymentProvisioning =
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: row.id,
        userId,
        repoFullName: dto.repoFullName,
        request: dto.deploymentProvisioning,
      });

    return {
      id: row.id,
      repoFullName: dto.repoFullName,
      status: 'provisioned',
      workflowPath,
      workflowFiles: this.workflowFileMetadata(workflowFiles),
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
      deploymentProvisioning,
    };
  }

  // ─── GET /projects ─────────────────────────────────────────────────────────

  async listProjects(
    userId: string,
    limit = 25,
  ): Promise<ProvisionedProjectsResponse> {
    const rows = await this.projectsRepository.listByUser(userId, limit);
    return {
      items: rows.map((row) => this.toProvisionedProject(row)),
    };
  }

  // ─── DELETE /projects/:id ──────────────────────────────────────────────────

  /**
   * Removes a provisioned_projects record from FlowCI's database.
   * The GitHub repository, its workflow YAML files, and its GitHub Secrets
   * are NOT touched — this is a FlowCI tracking disconnect only.
   * CASCADE deletes ci.project_ci_tokens automatically via the FK.
   */
  async disconnectProject(projectId: string, userId: string): Promise<void> {
    const deleted = await this.projectsRepository.deleteByIdAndUser(
      projectId,
      userId,
    );
    if (!deleted) {
      throw new NotFoundException(
        `Project '${projectId}' not found or does not belong to the current user.`,
      );
    }
  }

  // ─── POST /projects/sync ───────────────────────────────────────────────────

  /**
   * Checks each provisioned project against the GitHub API to see if its
   * repository still exists. Projects whose repos have been deleted are marked
   * 'orphaned'; orphaned projects whose repos reappear are restored to
   * 'provisioned'. Requires a valid GitHub access token in session.
   */
  async syncProjects(
    userId: string,
    accessToken: string,
  ): Promise<SyncProjectsResponse> {
    const rows = await this.projectsRepository.listByUser(userId, 100);
    if (rows.length === 0) {
      return { orphaned: 0, reachable: 0, total: 0 };
    }

    const orphanedIds: string[] = [];
    const reachableIds: string[] = [];

    // Check repos concurrently — cap at 10 parallel requests to avoid GitHub
    // secondary rate-limit triggers on large project lists.
    const CONCURRENCY = 10;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const exists = await this.githubService.repoExists(
              accessToken,
              row.repo_full_name,
            );
            if (exists) {
              reachableIds.push(row.id);
            } else {
              orphanedIds.push(row.id);
            }
          } catch (err) {
            // If GitHub API errors (e.g. 5xx), skip — do not mark as orphaned
            // to avoid false-positives from transient failures.
            this.logger.warn(
              `Sync: GitHub check failed for ${row.repo_full_name}: ${String(err)}`,
            );
          }
        }),
      );
    }

    const [orphanedCount, reachableCount] = await Promise.all([
      this.projectsRepository.markOrphaned(orphanedIds, userId),
      this.projectsRepository.markReachable(reachableIds, userId),
    ]);

    return {
      orphaned: orphanedCount,
      reachable: reachableCount,
      total: rows.length,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve the catalog templateId from projectTypeId + optional workflowRecipeId.
   * Uses the recipe's templateByProjectType mapping. Falls back to
   * "{projectTypeId}-standard" when no recipe is supplied.
   */
  private async resolveProvisioningToken(
    userId: string,
    oauthAccessToken: string | null | undefined,
  ): Promise<string> {
    const installationToken =
      await this.githubService.getInstallationAccessTokenForUser(userId);

    if (installationToken) {
      return installationToken;
    }

    if (oauthAccessToken) {
      return oauthAccessToken;
    }

    throw new UnauthorizedException(
      'No usable GitHub token found. Link the GitHub App installation or re-authenticate via GitHub OAuth.',
    );
  }

  private resolveTemplateId(
    projectTypeId: string,
    workflowRecipeId?: string,
  ): string {
    const { recipes } = this.catalogService.getProjectOptions();
    const recipeId = workflowRecipeId ?? 'standard';
    const recipe = recipes.find((r) => r.id === recipeId);

    if (recipe) {
      const mapped = recipe.templateByProjectType[projectTypeId];
      if (mapped) {
        return mapped;
      }
    }

    // Fallback: conventional naming that matches the YAML file names on disk
    return `${projectTypeId}-${recipeId}`;
  }

  private filterDeploymentProvisioningRequest(
    request: DeploymentProvisioningRequestDto | undefined,
    slots: DeploymentProvisioningTargetDto['slot'][],
  ): DeploymentProvisioningRequestDto | undefined {
    if (!request) {
      return undefined;
    }

    return {
      enabled: request.enabled,
      targets: request.targets.filter((target) => slots.includes(target.slot)),
    };
  }

  private combineDeploymentProvisioningResults(
    results: DeploymentProvisioningResult[],
  ): DeploymentProvisioningResult {
    const targets = results.flatMap((result) => result.targets);
    if (targets.length === 0) {
      return { status: 'skipped', targets: [] };
    }

    const failedCount = targets.filter(
      (target) => target.status === 'failed',
    ).length;

    return {
      status:
        failedCount === 0
          ? 'completed'
          : failedCount === targets.length
            ? 'failed'
            : 'partial',
      targets,
    };
  }

  /**
   * Load the template from the catalog, apply substitutions, and return the
   * generated YAML string plus the derived output file name.
   */
  private async buildWorkflowYaml(
    templateId: string,
    serviceName: string,
    servicePath?: string,
    nodeVersion?: string,
    coverageThreshold?: number,
    customOutputFileName?: string,
    enhancements?: Array<
      | 'strictProductionApproval'
      | 'enableUatApproval'
      | 'disablePlaywright'
      | 'disableK6'
    >,
  ): Promise<{ generatedYaml: string; outputFileName: string }> {
    const template = await this.catalogService.getTemplateById(templateId);
    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }

    const source = await readFile(template.workflowPath, 'utf8');

    // Use DEFAULT_SCHEMA (the js-yaml default) explicitly to document that no
    // unsafe tag constructors (!!js/function, !!js/regexp, etc.) are permitted.
    // This is equivalent to yaml.load() with no schema option, but makes the
    // intent clear and is resilient to any future js-yaml API drift.
    const parsed = yaml.load(source, { schema: yaml.DEFAULT_SCHEMA }) as Record<
      string,
      unknown
    > | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UnprocessableEntityException(
        'Workflow template could not be parsed',
      );
    }

    parsed.name = `${serviceName} - ${template.name}`;

    const onConfig = this.ensureObject(parsed, 'on');
    const dispatchConfig = this.ensureObject(onConfig, 'workflow_dispatch');
    const inputConfig = this.ensureObject(dispatchConfig, 'inputs');

    this.setInputDefault(inputConfig, 'service_name', serviceName, 'string');

    if (servicePath !== undefined) {
      this.setInputDefault(inputConfig, 'service_path', servicePath, 'string');
    }

    if (nodeVersion !== undefined) {
      this.setInputDefault(inputConfig, 'node_version', nodeVersion, 'string');
    }

    if (coverageThreshold !== undefined) {
      this.setInputDefault(
        inputConfig,
        'coverage_threshold',
        coverageThreshold,
        'number',
      );
    }

    if (enhancements && enhancements.length > 0) {
      const pipelineConfig = this.ensureObject(
        this.ensureObject(parsed, 'jobs'),
        'pipeline',
      );
      const withConfig = this.ensureObject(pipelineConfig, 'with');
      this.applyEnhancements(withConfig, enhancements);
    }

    const generatedYaml = yaml.dump(parsed, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });

    const outputFileName =
      customOutputFileName ??
      this.deriveOutputFileName(serviceName, template.id);

    return { generatedYaml, outputFileName };
  }

  private async buildWorkflowBundle(
    templateId: string,
    serviceName: string,
    servicePath?: string,
    nodeVersion?: string,
    coverageThreshold?: number,
    customOutputFileName?: string,
    enhancements?: Array<
      | 'strictProductionApproval'
      | 'enableUatApproval'
      | 'disablePlaywright'
      | 'disableK6'
    >,
  ): Promise<{ workflowFiles: StagedWorkflowFile[]; outputFileName: string }> {
    const template = await this.catalogService.getTemplateById(templateId);
    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }

    const bundle = buildStagedWorkflowBundle(template, {
      templateId,
      serviceName,
      ...(servicePath !== undefined && { servicePath }),
      ...(nodeVersion !== undefined && { nodeVersion }),
      ...(coverageThreshold !== undefined && { coverageThreshold }),
      ...(enhancements !== undefined && { enhancements }),
    });

    const outputFileName = customOutputFileName ?? '00-flowci-access.yml';
    return {
      workflowFiles: bundle.workflowFiles,
      outputFileName,
    };
  }

  private async pushWorkflowFiles(
    accessToken: string,
    owner: string,
    repo: string,
    workflowFiles: StagedWorkflowFile[],
  ): Promise<{ commitSha: string; commitUrl: string | null }> {
    let latest: { commitSha: string; commitUrl: string | null } | null = null;

    for (const file of workflowFiles) {
      latest = await this.pushWorkflowFile(
        accessToken,
        owner,
        repo,
        file.path,
        file.yaml,
      );
    }

    if (!latest) {
      throw new UnprocessableEntityException(
        'No workflow files were generated',
      );
    }

    return latest;
  }

  /**
   * Push a file to a GitHub repository via the Contents API.
   * If the file already exists (sha required), this will overwrite it.
   * Returns the commit SHA and HTML URL.
   */
  private async pushWorkflowFile(
    accessToken: string,
    owner: string,
    repo: string,
    filePath: string,
    content: string,
    commitMessage = 'ci: add FlowCI Studio workflow',
  ): Promise<{ commitSha: string; commitUrl: string | null }> {
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');

    // Check whether the file already exists so we can supply its sha (required for updates)
    let existingSha: string | undefined;
    try {
      const checkRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'cicd-workflow-product',
          },
        },
      );

      if (checkRes.ok) {
        const existing = (await checkRes.json()) as { sha?: string };
        existingSha = existing.sha;
      }
    } catch {
      // Not critical — proceed without sha; GitHub will reject if required
    }

    const body: Record<string, unknown> = {
      message: commitMessage,
      content: encodedContent,
      branch: 'main',
    };

    if (existingSha) {
      body['sha'] = existingSha;
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!putRes.ok) {
      const err = await putRes.text();
      throw new UnprocessableEntityException(
        `GitHub file push failed (${String(putRes.status)}): ${err}`,
      );
    }

    const response = (await putRes.json()) as GitHubContentsResponse;
    const commitSha = response.commit?.sha ?? '';
    const commitUrl = response.commit?.html_url ?? null;

    return { commitSha, commitUrl };
  }

  /**
   * Push a full project scaffold to the repository on main, then add README.md.
   * Called immediately after createRepo() so that all downstream branches
   * branch off a commit that already contains these files.
   *
   * The scaffold structure varies by repoShape:
   * - standalone/multi-repo: flat files at repo root
   * - monorepo: workspace root + packages/core with project references
   * - microservices: backend/ and frontend/ subdirectories
   */
  private async pushStarterFiles(
    accessToken: string,
    owner: string,
    repo: string,
    opts: {
      projectName: string;
      stack?: string;
      repoShape?: string;
      frontendStack?: string;
      frontendServiceName?: string;
      backendServiceName?: string;
    },
  ): Promise<void> {
    const {
      projectName,
      stack = 'nodejs',
      repoShape,
      frontendStack,
      frontendServiceName,
      backendServiceName,
    } = opts;

    const scaffoldOptions = {
      serviceName: projectName,
      stack,
      includeDocker: defaultIncludeDocker(stack),
      ...(repoShape ? { repoShape } : {}),
      ...(frontendStack ? { frontendStack } : {}),
      ...(frontendServiceName ? { frontendServiceName } : {}),
      ...(backendServiceName ? { backendServiceName } : {}),
    };

    const scaffoldFiles = buildProjectScaffold(scaffoldOptions);

    for (const file of scaffoldFiles) {
      try {
        await this.pushWorkflowFile(
          accessToken,
          owner,
          repo,
          file.path,
          file.content,
          'chore: initialize project scaffold',
        );
      } catch (err) {
        this.logger.warn(
          `Failed to push scaffold file ${file.path}: ${String(err)}`,
        );
      }
    }

    // Always push README.md (.gitignore is included in the scaffold above)
    const readmeContent = [
      `# ${projectName}`,
      '',
      'This repository was created and configured by FlowCI Studio.',
      '',
      '## Branch strategy',
      '',
      '| Branch | Purpose |',
      '|--------|---------|',
      '| main   | Stable baseline — protected |',
      '| uat    | Pre-production gate — protected |',
      '| test   | Integration target — protected |',
      '',
      '## CI/CD',
      '',
      'Workflow files live in `.github/workflows/`. Push to `test` to trigger your first run.',
      '',
      '## Getting started',
      '',
      'Clone this repository, install dependencies, and push your code to a feature branch targeting `test` to activate the CI pipeline.',
    ].join('\n');

    await this.pushWorkflowFile(
      accessToken,
      owner,
      repo,
      'README.md',
      readmeContent,
      'chore: add project metadata',
    );
  }

  /**
   * Create two separate GitHub repositories (backend + frontend) each with
   * starter files, a workflow file, protected branches, and a DB row.
   */
  private async createMultiRepoProject(
    userId: string,
    _userLogin: string,
    accessToken: string,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    if (!dto.multiRepoConfig) {
      throw new UnprocessableEntityException(
        'multiRepoConfig is required for multi-repo shape',
      );
    }

    const { backend, frontend } = dto.multiRepoConfig;

    // Derive repo names — avoid double-suffixing if caller already appended -be
    const beRepoName = dto.repoName.endsWith('-be')
      ? dto.repoName
      : `${dto.repoName}-be`;
    const feRepoName = beRepoName.replace(/-be$/, '-fe');

    // ── Backend repository ──────────────────────────────────────────────────

    const backendTemplateId = this.resolveTemplateId(
      backend.projectTypeId,
      backend.workflowRecipeId,
    );
    const {
      workflowFiles: backendWorkflowFiles,
      outputFileName: backendOutputFileName,
    } = await this.buildWorkflowBundle(
      backendTemplateId,
      backend.serviceName,
      backend.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
    );

    const {
      repoUrl: beRepoUrl,
      ownerLogin,
      repoName: actualBeRepoName,
    } = await this.githubService.createRepo(accessToken, {
      repoName: beRepoName,
      private: dto.visibility === 'private',
    });

    const beRepoFullName = `${ownerLogin}/${actualBeRepoName}`;

    await this.pushStarterFiles(accessToken, ownerLogin, actualBeRepoName, {
      projectName: backend.serviceName || actualBeRepoName,
      stack: backend.projectTypeId,
      repoShape: 'standalone',
    });

    const backendWorkflowPath =
      backendWorkflowFiles[0]?.path ??
      `.github/workflows/${backendOutputFileName}`;
    const { commitSha: backendCommitSha, commitUrl: backendCommitUrl } =
      await this.pushWorkflowFiles(
        accessToken,
        ownerLogin,
        actualBeRepoName,
        backendWorkflowFiles,
      );

    for (const branch of ['uat', 'test'] as const) {
      await this.githubService.createBranch(
        accessToken,
        ownerLogin,
        actualBeRepoName,
        branch,
        'main',
      );
    }

    for (const branch of ['test', 'uat', 'main'] as const) {
      await this.githubService.applyBranchProtection(
        accessToken,
        ownerLogin,
        actualBeRepoName,
        branch,
      );
    }

    const backendRow = await this.projectsRepository.create({
      userId,
      repoFullName: beRepoFullName,
      templateId: backendTemplateId,
      serviceName: backend.serviceName,
      workflowPath: backendWorkflowPath,
      status: 'provisioned',
      githubCommitSha: backendCommitSha,
      githubCommitUrl: backendCommitUrl,
      repoUrl: beRepoUrl,
      visibility: dto.visibility,
      repoShape: dto.repoShape ?? null,
      projectTypeId: backend.projectTypeId,
      workflowRecipeId: backend.workflowRecipeId ?? null,
      projectOptions: {
        ...(dto.tests ? { tests: dto.tests } : {}),
        workflowFiles: this.workflowFileMetadata(backendWorkflowFiles),
      },
    });

    const backendCiToken = await this.ciService.issueProjectToken(
      backendRow.id,
    );
    await this.githubService.setActionsSecret(
      accessToken,
      ownerLogin,
      actualBeRepoName,
      'CI_TOKEN',
      backendCiToken.token,
    );

    // ── Frontend repository (non-fatal on failure) ──────────────────────────

    const deploymentProvisioningResults: DeploymentProvisioningResult[] = [
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: backendRow.id,
        userId,
        repoFullName: beRepoFullName,
        request: this.filterDeploymentProvisioningRequest(
          dto.deploymentProvisioning,
          ['backend'],
        ),
      }),
    ];

    let feRepoFullName: string | undefined;
    let feRepoUrl: string | undefined;

    try {
      const frontendTemplateId = this.resolveTemplateId(
        frontend.projectTypeId,
        frontend.workflowRecipeId,
      );
      const {
        workflowFiles: frontendWorkflowFiles,
        outputFileName: frontendOutputFileName,
      } = await this.buildWorkflowBundle(
        frontendTemplateId,
        frontend.serviceName,
        frontend.servicePath,
        dto.nodeVersion,
        dto.coverageThreshold,
      );

      const {
        repoUrl: resolvedFeRepoUrl,
        ownerLogin: feOwnerLogin,
        repoName: actualFeRepoName,
      } = await this.githubService.createRepo(accessToken, {
        repoName: feRepoName,
        private: dto.visibility === 'private',
      });

      feRepoFullName = `${feOwnerLogin}/${actualFeRepoName}`;
      feRepoUrl = resolvedFeRepoUrl;

      await this.pushStarterFiles(accessToken, feOwnerLogin, actualFeRepoName, {
        projectName: frontend.serviceName || actualFeRepoName,
        stack: frontend.projectTypeId,
        repoShape: 'standalone',
      });

      const frontendWorkflowPath =
        frontendWorkflowFiles[0]?.path ??
        `.github/workflows/${frontendOutputFileName}`;
      const { commitSha: frontendCommitSha, commitUrl: frontendCommitUrl } =
        await this.pushWorkflowFiles(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          frontendWorkflowFiles,
        );

      for (const branch of ['uat', 'test'] as const) {
        await this.githubService.createBranch(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          branch,
          'main',
        );
      }

      for (const branch of ['test', 'uat', 'main'] as const) {
        await this.githubService.applyBranchProtection(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          branch,
        );
      }

      const frontendRow = await this.projectsRepository.create({
        userId,
        repoFullName: feRepoFullName,
        templateId: frontendTemplateId,
        serviceName: frontend.serviceName,
        workflowPath: frontendWorkflowPath,
        status: 'provisioned',
        githubCommitSha: frontendCommitSha,
        githubCommitUrl: frontendCommitUrl,
        repoUrl: feRepoUrl,
        visibility: dto.visibility,
        repoShape: dto.repoShape ?? null,
        projectTypeId: frontend.projectTypeId,
        workflowRecipeId: frontend.workflowRecipeId ?? null,
        projectOptions: {
          workflowFiles: this.workflowFileMetadata(frontendWorkflowFiles),
        },
      });

      const frontendCiToken = await this.ciService.issueProjectToken(
        frontendRow.id,
      );
      await this.githubService.setActionsSecret(
        accessToken,
        feOwnerLogin,
        actualFeRepoName,
        'CI_TOKEN',
        frontendCiToken.token,
      );

      deploymentProvisioningResults.push(
        await this.projectDeploymentProvisioningService.provisionForProject({
          projectId: frontendRow.id,
          userId,
          repoFullName: feRepoFullName,
          request: this.filterDeploymentProvisioningRequest(
            dto.deploymentProvisioning,
            ['frontend'],
          ),
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Multi-repo project created but frontend repo provisioning failed: ${String(err)}`,
      );
    }

    return {
      id: backendRow.id,
      repoFullName: beRepoFullName,
      repoUrl: beRepoUrl,
      status: 'provisioned',
      workflowPath: backendWorkflowPath,
      workflowFiles: this.workflowFileMetadata(backendWorkflowFiles),
      githubCommitSha: backendCommitSha,
      githubCommitUrl: backendCommitUrl,
      projectTypeId: backend.projectTypeId,
      workflowRecipeId: backend.workflowRecipeId ?? '',
      additionalWorkflowPaths: [],
      ...(feRepoFullName !== undefined && {
        secondaryRepoFullName: feRepoFullName,
      }),
      ...(feRepoUrl !== undefined && { secondaryRepoUrl: feRepoUrl }),
      deploymentProvisioning: this.combineDeploymentProvisioningResults(
        deploymentProvisioningResults,
      ),
    };
  }

  private parseRepoFullName(repoFullName: string): [string, string] {
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnprocessableEntityException(
        `Invalid repoFullName '${repoFullName}'. Expected format: "owner/repo"`,
      );
    }

    return [parts[0], parts[1]];
  }

  private deriveOutputFileName(
    serviceName: string,
    templateId: string,
  ): string {
    const normalized = serviceName
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');

    return `${normalized || 'service'}-${templateId}.yml`;
  }

  private ensureObject(
    parent: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const existing = parent[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      parent[key] = next;
      return next;
    }

    return existing as Record<string, unknown>;
  }

  private setInputDefault(
    inputs: Record<string, unknown>,
    key: string,
    value: string | number,
    type: 'string' | 'number',
  ): void {
    const existing = inputs[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      inputs[key] = {
        description: `Auto-generated default for ${key}`,
        required: false,
        type,
        default: value,
      };
    } else {
      const record = existing as Record<string, unknown>;
      record['default'] = value;
      if (!record['type']) {
        record['type'] = type;
      }
    }
  }

  private applyEnhancements(
    withConfig: Record<string, unknown>,
    enhancements: Array<
      | 'strictProductionApproval'
      | 'enableUatApproval'
      | 'disablePlaywright'
      | 'disableK6'
    >,
  ): void {
    for (const enhancement of enhancements) {
      switch (enhancement) {
        case 'disablePlaywright':
          withConfig['run-playwright'] = false;
          break;
        case 'disableK6':
          withConfig['run-k6'] = false;
          break;
        case 'enableUatApproval':
          withConfig['require-uat-approval'] = true;
          break;
        case 'strictProductionApproval':
          withConfig['require-production-approval'] = true;
          break;
        default:
          break;
      }
    }
  }

  private toProvisionedProject(row: ProvisionedProjectRow): ProvisionedProject {
    const workflowFiles = Array.isArray(row.project_options?.['workflowFiles'])
      ? (row.project_options['workflowFiles'] as WorkflowFileMetadata[])
      : null;

    return {
      id: row.id,
      repoFullName: row.repo_full_name,
      templateId: row.template_id,
      serviceName: row.service_name,
      workflowPath: row.workflow_path,
      workflowFiles,
      status: row.status,
      githubCommitSha: row.github_commit_sha,
      githubCommitUrl: row.github_commit_url,
      failureReason: row.failure_reason,
      repoUrl: row.repo_url,
      visibility: row.visibility,
      repoShape: row.repo_shape,
      projectTypeId: row.project_type_id,
      workflowRecipeId: row.workflow_recipe_id,
      projectOptions: row.project_options,
    };
  }

  private workflowFileMetadata(
    workflowFiles: StagedWorkflowFile[],
  ): WorkflowFileMetadata[] {
    return workflowFiles.map((file) => ({
      stage: file.stage,
      name: file.name,
      path: file.path,
      gated: file.gated,
    }));
  }
}
