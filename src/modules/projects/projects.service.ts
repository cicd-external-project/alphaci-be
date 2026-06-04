import { readFile } from 'node:fs/promises';

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import yaml from 'js-yaml';

import { CatalogService } from '../catalog/catalog.service';
import { GithubService } from '../github/github.service';
import { ProjectsRepository, type ProvisionedProjectRow } from './projects.repository';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { SetupProjectDto } from './dto/setup-project.dto';

// ─── Response shapes (match FE contracts exactly) ────────────────────────────

export interface CreateProjectResponse {
  id: string;
  repoFullName: string;
  repoUrl: string;
  status: 'provisioned';
  workflowPath: string;
  githubCommitSha: string;
  githubCommitUrl: string | null;
  projectTypeId: string;
  workflowRecipeId: string;
}

export interface SetupProjectResponse {
  id: string;
  repoFullName: string;
  status: 'provisioned';
  workflowPath: string;
  githubCommitSha: string;
  githubCommitUrl: string | null;
}

export interface ProvisionedProject {
  id: string;
  repoFullName: string;
  templateId: string;
  serviceName: string;
  workflowPath: string;
  status: 'provisioning' | 'provisioned' | 'failed';
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
  ) {}

  // ─── POST /projects ────────────────────────────────────────────────────────

  async createProject(
    userId: string,
    userLogin: string,
    accessToken: string,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    // 1. Resolve templateId from projectTypeId + workflowRecipeId
    const templateId = this.resolveTemplateId(dto.projectTypeId, dto.workflowRecipeId);

    // 2. Load template and build workflow YAML
    const { generatedYaml, outputFileName } = await this.buildWorkflowYaml(
      templateId,
      dto.serviceName,
      dto.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
      dto.outputFileName,
    );

    // 3. Create the GitHub repository (auto_init: true creates main branch)
    const { repoUrl, ownerLogin, repoName } = await this.githubService.createRepo(
      accessToken,
      {
        repoName: dto.repoName,
        private: dto.visibility === 'private',
      },
    );

    const repoFullName = `${ownerLogin}/${repoName}`;

    // 4. Create uat and test branches from main
    for (const branch of ['uat', 'test'] as const) {
      await this.githubService.createBranch(accessToken, ownerLogin, repoName, branch, 'main');
    }

    // 5. Apply branch protection to all three branches
    for (const branch of ['test', 'uat', 'main'] as const) {
      await this.githubService.applyBranchProtection(accessToken, ownerLogin, repoName, branch);
    }

    // 6. Push the workflow YAML to .github/workflows/{outputFileName} on main
    const workflowPath = `.github/workflows/${outputFileName}`;
    const { commitSha, commitUrl } = await this.pushWorkflowFile(
      accessToken,
      ownerLogin,
      repoName,
      workflowPath,
      generatedYaml,
    );

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
      projectOptions: dto.tests ? { tests: dto.tests } : {},
    });

    return {
      id: row.id,
      repoFullName,
      repoUrl,
      status: 'provisioned',
      workflowPath,
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
      projectTypeId: dto.projectTypeId,
      workflowRecipeId: dto.workflowRecipeId ?? '',
    };
  }

  // ─── POST /projects/setup ──────────────────────────────────────────────────

  async setupProject(
    userId: string,
    accessToken: string,
    dto: SetupProjectDto,
  ): Promise<SetupProjectResponse> {
    // 1. Build workflow YAML from the given templateId
    const { generatedYaml, outputFileName } = await this.buildWorkflowYaml(
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
    const workflowPath = `.github/workflows/${outputFileName}`;
    const { commitSha, commitUrl } = await this.pushWorkflowFile(
      accessToken,
      owner,
      repo,
      workflowPath,
      generatedYaml,
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
    });

    return {
      id: row.id,
      repoFullName: dto.repoFullName,
      status: 'provisioned',
      workflowPath,
      githubCommitSha: commitSha,
      githubCommitUrl: commitUrl,
    };
  }

  // ─── GET /projects ─────────────────────────────────────────────────────────

  async listProjects(userId: string): Promise<ProvisionedProjectsResponse> {
    const rows = await this.projectsRepository.listByUser(userId);
    return {
      items: rows.map((row) => this.toProvisionedProject(row)),
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve the catalog templateId from projectTypeId + optional workflowRecipeId.
   * Uses the recipe's templateByProjectType mapping. Falls back to
   * "{projectTypeId}-standard" when no recipe is supplied.
   */
  private resolveTemplateId(projectTypeId: string, workflowRecipeId?: string): string {
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
    const parsed = yaml.load(source, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UnprocessableEntityException('Workflow template could not be parsed');
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
      this.setInputDefault(inputConfig, 'coverage_threshold', coverageThreshold, 'number');
    }

    if (enhancements && enhancements.length > 0) {
      const pipelineConfig = this.ensureObject(this.ensureObject(parsed, 'jobs'), 'pipeline');
      const withConfig = this.ensureObject(pipelineConfig, 'with');
      this.applyEnhancements(withConfig, enhancements);
    }

    const generatedYaml = yaml.dump(parsed, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });

    const outputFileName =
      customOutputFileName ?? this.deriveOutputFileName(serviceName, template.id);

    return { generatedYaml, outputFileName };
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
      message: 'ci: add FlowCI Studio workflow',
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

  private parseRepoFullName(repoFullName: string): [string, string] {
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnprocessableEntityException(
        `Invalid repoFullName '${repoFullName}'. Expected format: "owner/repo"`,
      );
    }

    return [parts[0], parts[1]];
  }

  private deriveOutputFileName(serviceName: string, templateId: string): string {
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
    return {
      id: row.id,
      repoFullName: row.repo_full_name,
      templateId: row.template_id,
      serviceName: row.service_name,
      workflowPath: row.workflow_path,
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
}
