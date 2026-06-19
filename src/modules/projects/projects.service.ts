import { readFile } from 'node:fs/promises';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yaml from 'js-yaml';

import type { AppConfig } from '../../config/app.config';
import { CatalogService } from '../catalog/catalog.service';
import { CiService } from '../ci/ci.service';
import {
  CiTokensRepository,
  type ProjectTokenStatus,
} from '../ci/ci-tokens.repository';
import { AuditEventsService } from '../audit/audit-events.service';
import { DeploymentTargetsRepository } from '../env-provisioning/deployment-targets.repository';
import { EnvVarsRepository } from '../env-provisioning/env-vars.repository';
import type {
  DeploymentTargetSummary,
  EnvVarMetadata,
} from '../env-provisioning/env-provisioning.types';
import { GithubService } from '../github/github.service';
import { ProjectDeploymentProvisioningService } from '../env-provisioning/project-deployment-provisioning.service';
import {
  WorkflowHistoryRepository,
  type WorkflowHistoryEntry,
} from '../persistence/workflow-history.repository';
import {
  ProjectsRepository,
  type ProvisionedProjectRow,
  type ProvisionedProjectStatus,
} from './projects.repository';
import {
  ProjectDashboardSnapshotsRepository,
  type ProjectDashboardSnapshot,
  type ProjectDashboardSnapshotFinding,
} from './project-dashboard-snapshots.repository';
import {
  ProjectWorkflowSettingsRepository,
  type ProjectWorkflowSettingsRowValue,
} from './project-workflow-settings.repository';
import {
  ProjectWorkflowUpdateRequestsRepository,
  type WorkflowUpdateRequestRecord,
} from './project-workflow-update-requests.repository';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { SetupProjectDto } from './dto/setup-project.dto';
import {
  buildStagedWorkflowBundle,
  CI_REPORT_URL,
  type StagedWorkflowFile,
  type WorkflowFileMetadata,
} from '../workflows/staged-workflow.builder';
import type {
  DeploymentProvider,
  DeploymentWorkflowTarget,
} from '../workflows/dto/generate-workflow.dto';
import { UsageQuotaService } from '../usage/usage-quota.service';
import type { UsageLimitCode } from '../usage/usage.types';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import {
  buildProjectScaffold,
  defaultIncludeDocker,
  normalizeRepoShape,
} from './scaffold.builder';
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
    ownershipMode: 'byo' | 'flowci_managed';
    deploymentStrategy:
      | 'provider_native'
      | 'vercel_git_connected'
      | 'vercel_ci_pushed'
      | 'render_git_connected'
      | 'render_image_pushed'
      | 'render_existing_service'
      | null;
    status: 'created' | 'registered' | 'failed';
    deploymentTargetId: string | null;
    providerProjectId: string | null;
    providerProjectName: string | null;
    providerMetadata: Record<string, unknown>;
    renderServiceType?: string | null;
    renderRuntime?: string | null;
    renderInstanceType?: string | null;
    renderRegion?: string | null;
    renderEnvironmentName?: 'test' | 'uat' | 'production' | null;
    dockerContext?: string | null;
    dockerfilePath?: string | null;
    imageUrl?: string | null;
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
  isExample?: boolean;
}

export interface SyncProjectsResponse {
  orphaned: number;
  reachable: number;
  total: number;
}

export interface ProvisionedProjectsResponse {
  items: ProvisionedProject[];
}

export type ProjectOverviewHealthStatus = 'ok' | 'warning' | 'error';

export interface ProjectOverviewResponse {
  project: ProvisionedProject & {
    createdAt: string;
    updatedAt: string;
  };
  workflow: {
    path: string;
    files: WorkflowFileMetadata[];
    stageCount: number;
    history: WorkflowHistoryEntry[];
  };
  deploymentTargets: {
    items: DeploymentTargetSummary[];
    count: number;
  };
  environment: {
    items: EnvVarMetadata[];
    count: number;
    failedCount: number;
  };
  ciAuth: {
    status: 'active' | 'revoked' | 'missing';
    tokenPresent: boolean;
    tokenPrefix: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    revokedAt: string | null;
  };
  health: {
    summary: ProjectOverviewHealthStatus;
    checks: Array<{
      key: string;
      label: string;
      status: ProjectOverviewHealthStatus;
      message: string;
    }>;
  };
  syncSnapshot: {
    enabled: boolean;
    mode: 'local_snapshot';
    latest: ProjectDashboardSnapshot | null;
  };
  capabilities: {
    envProvisioning: boolean;
    workflowSettings: boolean;
    syncSnapshots: boolean;
    ciRunTracking: boolean;
    deploymentHistory: boolean;
    driftDetection: boolean;
  };
}

export interface ProjectSyncSnapshotResponse {
  snapshot: ProjectDashboardSnapshot;
  overview: ProjectOverviewResponse;
}

export interface ProjectAuditEventsResponse {
  enabled: boolean;
  items: Array<{
    id: string;
    eventCode: string;
    message: string;
    actorUserId: string | null;
    createdAt: string;
  }>;
}

export interface WorkflowSettings {
  projectId: string;
  templateId: string;
  projectTypeId: string | null;
  workflowRecipeId: string | null;
  serviceName: string;
  servicePath: string;
  nodeVersion: string;
  packageManager: 'npm';
  coverageThreshold: number;
  centralWorkflowRef: string;
  checks: {
    lint: boolean;
    unit: boolean;
    build: boolean;
    security: boolean;
  };
}

export interface WorkflowSettingsResponse {
  enabled: boolean;
  source: 'stored' | 'project_options';
  settings: WorkflowSettings;
}

export interface WorkflowSettingsPreviewRequest {
  templateId?: string;
  projectTypeId?: string | null;
  workflowRecipeId?: string | null;
  serviceName?: string;
  servicePath?: string;
  nodeVersion?: string;
  packageManager?: 'npm';
  coverageThreshold?: number;
  centralWorkflowRef?: string;
  checks?: Partial<WorkflowSettings['checks']>;
}

export interface WorkflowSettingsPreviewResponse {
  settings: WorkflowSettings;
  workflowFiles: StagedWorkflowFile[];
  diffSummary: Array<{
    path: string;
    status: 'new' | 'changed' | 'unchanged';
  }>;
  validationWarnings: Array<{
    field: string;
    message: string;
  }>;
}

export interface WorkflowUpdatePullRequestResponse {
  projectId: string;
  repoFullName: string;
  branchName: string;
  workflowPath: string;
  workflowFiles: WorkflowFileMetadata[];
  pullRequestNumber: number;
  pullRequestUrl: string;
  status: 'created';
  request: WorkflowUpdateRequestRecord | null;
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
    @Optional()
    private readonly ciTokensRepository?: CiTokensRepository,
    @Optional()
    private readonly deploymentTargetsRepository?: DeploymentTargetsRepository,
    @Optional()
    private readonly envVarsRepository?: EnvVarsRepository,
    @Optional()
    private readonly workflowHistoryRepository?: WorkflowHistoryRepository,
    @Optional()
    private readonly dashboardSnapshotsRepository?: ProjectDashboardSnapshotsRepository,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly workflowSettingsRepository?: ProjectWorkflowSettingsRepository,
    @Optional()
    private readonly workflowUpdateRequestsRepository?: ProjectWorkflowUpdateRequestsRepository,
    @Optional()
    private readonly usageQuotaService?: UsageQuotaService,
    @Optional()
    private readonly auditEventsService?: AuditEventsService,
    @Optional()
    private readonly workspacesService?: WorkspacesService,
    @Optional()
    private readonly notificationEventsService?: NotificationEventsService,
  ) {}

  // ─── POST /projects ────────────────────────────────────────────────────────

  async createProject(
    userId: string,
    userLogin: string,
    accessToken: string | null,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    await this.assertWithinQuota(userId, 'projects', 1, null);
    const provisioningToken = await this.resolveProvisioningToken(
      userId,
      accessToken,
    );

    // The catalog publishes the shape IDs 'mono' and 'multi'; normalize so
    // the flow dispatch never silently falls back to the standalone path.
    const repoShape = normalizeRepoShape(dto.repoShape);

    if (repoShape === 'microservices') {
      return this.createMicroservicesProject(
        userId,
        userLogin,
        provisioningToken,
        dto,
      );
    }

    if (repoShape === 'multi-repo') {
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

    const deploymentSlots = this.resolveSingleRepoDeploymentSlots(
      dto.deploymentProvisioning,
    );

    // 2. Load template and build workflow YAML
    const { workflowFiles, outputFileName } = await this.buildWorkflowBundle({
      templateId,
      serviceName: dto.serviceName,
      servicePath: dto.servicePath,
      nodeVersion: dto.nodeVersion,
      coverageThreshold: dto.coverageThreshold,
      customOutputFileName: dto.outputFileName,
      deploymentProvider: this.extractDeploymentProvider(
        dto.deploymentProvisioning,
        deploymentSlots[0] ?? 'standalone',
      ),
      deploymentTargets: this.resolveDeploymentWorkflowTargets(
        dto.deploymentProvisioning,
        deploymentSlots,
        dto.servicePath,
      ),
    });

    // 3. Create the GitHub repository (auto_init: true creates main branch)
    const { repoUrl, ownerLogin, repoName } =
      await this.githubService.createRepo(provisioningToken, {
        repoName: dto.repoName,
        private: dto.visibility === 'private',
      });

    const repoFullName = `${ownerLogin}/${repoName}`;
    const workflowPath =
      workflowFiles[0]?.path ?? `.github/workflows/${outputFileName}`;

    // Once the repo exists, wrap the remaining steps so a mid-flow failure
    // compensates by deleting the half-created repo + DB row instead of leaving
    // an orphan that would 422 on the next attempt.
    let row: ProvisionedProjectRow | undefined;
    let provisioningComplete = false;
    try {
      // 3.5 Push scaffold + README to main so all downstream branches inherit them
      await this.pushStarterFiles(provisioningToken, ownerLogin, repoName, {
        projectName: dto.serviceName,
        stack: dto.projectTypeId,
        repoShape,
        ...(dto.tests?.['docker'] !== undefined && {
          includeDocker: dto.tests['docker'],
        }),
      });

      // 4. Persist the project, issue the CI token, and install the Actions
      // secrets BEFORE any workflow YAML exists. The access-gate workflow runs
      // the instant a workflow file is pushed (and again on branch creation),
      // so the secrets must already be present or that first run fails for lack
      // of CI_TOKEN. Secrets are installed strictly so a token without
      // `secrets:write` aborts provisioning here rather than producing a repo
      // whose pipelines can never authenticate.
      row = await this.projectsRepository.create({
        userId,
        workspaceId: await this.resolveDefaultWorkspaceId(userId),
        repoFullName,
        templateId,
        serviceName: dto.serviceName,
        workflowPath,
        status: 'provisioned',
        repoUrl,
        visibility: dto.visibility,
        repoShape,
        projectTypeId: dto.projectTypeId,
        workflowRecipeId: dto.workflowRecipeId ?? null,
        projectOptions: {
          ...(dto.tests ? { tests: dto.tests } : {}),
          workflowFiles: this.workflowFileMetadata(workflowFiles),
        },
      });

      const ciToken = await this.ciService.issueProjectToken(row.id);
      await this.githubService.setActionsSecretStrict(
        provisioningToken,
        ownerLogin,
        repoName,
        'CI_TOKEN',
        ciToken.token,
      );
      await this.githubService.setActionsSecretStrict(
        provisioningToken,
        ownerLogin,
        repoName,
        'CI_REPORT_URL',
        CI_REPORT_URL,
      );

      // 5. Push workflow YAML to main now that the secrets exist, then record
      // the resulting commit on the project row.
      const { commitSha, commitUrl } = await this.pushWorkflowFiles(
        provisioningToken,
        ownerLogin,
        repoName,
        workflowFiles,
      );
      await this.projectsRepository.updateStatus(
        row.id,
        'provisioned',
        commitSha,
        commitUrl,
      );

      // 6. Create develop, uat and test branches from main (scaffold +
      // workflow + secrets present). `develop` is a protected staging branch;
      // no CI runs on it (pipeline triggers stay test/uat/main only).
      for (const branch of ['develop', 'uat', 'test'] as const) {
        await this.githubService.createBranch(
          provisioningToken,
          ownerLogin,
          repoName,
          branch,
          'main',
        );
      }

      // 7. Apply branch protection to all four long-lived branches
      for (const branch of ['develop', 'test', 'uat', 'main'] as const) {
        await this.githubService.applyBranchProtection(
          provisioningToken,
          ownerLogin,
          repoName,
          branch,
        );
      }

      // Repo is now fully usable; failures past this point must not delete it.
      provisioningComplete = true;

      const deploymentProvisioning =
        await this.projectDeploymentProvisioningService.provisionForProject({
          projectId: row.id,
          userId,
          repoFullName,
          githubAccessToken: provisioningToken,
          request: dto.deploymentProvisioning,
        });

      await this.recordProductEvent({
        userId,
        projectId: row.id,
        eventCode: 'project_created',
        title: 'Project created',
        body: `${repoFullName} is now tracked by FlowCI.`,
        metadata: {
          repoFullName,
          repoShape,
          projectTypeId: dto.projectTypeId,
        },
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
    } catch (error) {
      if (!provisioningComplete) {
        await this.compensateFailedProvision(
          provisioningToken,
          ownerLogin,
          repoName,
          row?.id,
          userId,
        );
      }
      throw error;
    }
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

    // 2. Build workflow YAML for both slots. Each slot gets a variant suffix
    // so the two pipelines coexist in one repo without overwriting each other,
    // and service paths default to the scaffold's backend/ and frontend/ dirs.
    const {
      workflowFiles: backendWorkflowFiles,
      outputFileName: backendOutputFileName,
    } = await this.buildWorkflowBundle({
      templateId: backendTemplateId,
      serviceName: backend.serviceName,
      servicePath: backend.servicePath ?? 'backend',
      nodeVersion: dto.nodeVersion,
      coverageThreshold: dto.coverageThreshold,
      deploymentProvider: this.extractDeploymentProvider(
        dto.deploymentProvisioning,
        'backend',
      ),
      deploymentTargets: this.resolveDeploymentWorkflowTargets(
        dto.deploymentProvisioning,
        ['backend'],
        backend.servicePath ?? 'backend',
      ),
      workflowVariant: 'backend',
    });

    const {
      workflowFiles: frontendWorkflowFiles,
      outputFileName: frontendOutputFileName,
    } = await this.buildWorkflowBundle({
      templateId: frontendTemplateId,
      serviceName: frontend.serviceName,
      servicePath: frontend.servicePath ?? 'frontend',
      nodeVersion: dto.nodeVersion,
      coverageThreshold: dto.coverageThreshold,
      deploymentProvider: this.extractDeploymentProvider(
        dto.deploymentProvisioning,
        'frontend',
      ),
      deploymentTargets: this.resolveDeploymentWorkflowTargets(
        dto.deploymentProvisioning,
        ['frontend'],
        frontend.servicePath ?? 'frontend',
      ),
      workflowVariant: 'frontend',
    });

    // 3. Create the GitHub repository once
    const { repoUrl, ownerLogin, repoName } =
      await this.githubService.createRepo(accessToken, {
        repoName: dto.repoName,
        private: dto.visibility === 'private',
      });

    const repoFullName = `${ownerLogin}/${repoName}`;
    const backendWorkflowPath =
      backendWorkflowFiles[0]?.path ??
      `.github/workflows/${backendOutputFileName}`;
    const frontendWorkflowPath =
      frontendWorkflowFiles[0]?.path ??
      `.github/workflows/${frontendOutputFileName}`;
    const additionalWorkflowPaths: string[] = [];

    let backendRow: ProvisionedProjectRow | undefined;
    let provisioningComplete = false;
    try {
      // 4. Push starter files to main so all subsequent branches inherit them
      await this.pushStarterFiles(accessToken, ownerLogin, repoName, {
        projectName: dto.repoName,
        stack: backend.projectTypeId,
        repoShape: 'microservices',
        ...(dto.tests?.['docker'] !== undefined && {
          includeDocker: dto.tests['docker'],
        }),
        backendServiceName: backend.serviceName,
        frontendStack: frontend.projectTypeId,
        frontendServiceName: frontend.serviceName,
      });

      // 5. Persist the backend row, issue the CI token, and install the shared
      // repo Actions secrets BEFORE pushing any workflow YAML — both pipeline
      // chains authenticate with the same repo-level CI_TOKEN, and the
      // access-gate runs as soon as a workflow file is pushed.
      backendRow = await this.projectsRepository.create({
        userId,
        workspaceId: await this.resolveDefaultWorkspaceId(userId),
        repoFullName,
        templateId: backendTemplateId,
        serviceName: backend.serviceName,
        workflowPath: backendWorkflowPath,
        status: 'provisioned',
        repoUrl,
        visibility: dto.visibility,
        repoShape: normalizeRepoShape(dto.repoShape),
        projectTypeId: backend.projectTypeId,
        workflowRecipeId: backend.workflowRecipeId ?? null,
        projectOptions: {
          ...(dto.tests ? { tests: dto.tests } : {}),
          workflowFiles: this.workflowFileMetadata(backendWorkflowFiles),
        },
      });

      const ciToken = await this.ciService.issueProjectToken(backendRow.id);
      await this.githubService.setActionsSecretStrict(
        accessToken,
        ownerLogin,
        repoName,
        'CI_TOKEN',
        ciToken.token,
      );
      await this.githubService.setActionsSecretStrict(
        accessToken,
        ownerLogin,
        repoName,
        'CI_REPORT_URL',
        CI_REPORT_URL,
      );

      // 6. Push backend workflow file to main, then record the commit.
      const { commitSha: backendCommitSha, commitUrl: backendCommitUrl } =
        await this.pushWorkflowFiles(
          accessToken,
          ownerLogin,
          repoName,
          backendWorkflowFiles,
        );
      await this.projectsRepository.updateStatus(
        backendRow.id,
        'provisioned',
        backendCommitSha,
        backendCommitUrl,
      );

      // 7. Push frontend workflow file to main (wrapped: failure should not block backend)
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

      // 8. Create develop, uat and test branches from main (starter files +
      // workflows + secrets present). `develop` is a protected staging branch;
      // no CI runs on it (pipeline triggers stay test/uat/main only).
      for (const branch of ['develop', 'uat', 'test'] as const) {
        await this.githubService.createBranch(
          accessToken,
          ownerLogin,
          repoName,
          branch,
          'main',
        );
      }

      // 9. Apply branch protection to all four long-lived branches once
      for (const branch of ['develop', 'test', 'uat', 'main'] as const) {
        await this.githubService.applyBranchProtection(
          accessToken,
          ownerLogin,
          repoName,
          branch,
        );
      }

      // Repo is now fully usable; failures past this point must not delete it.
      provisioningComplete = true;

      const deploymentProvisioningResults: DeploymentProvisioningResult[] = [
        await this.projectDeploymentProvisioningService.provisionForProject({
          projectId: backendRow.id,
          userId,
          repoFullName,
          githubAccessToken: accessToken,
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
            workspaceId: await this.resolveDefaultWorkspaceId(userId),
            repoFullName,
            templateId: frontendTemplateId,
            serviceName: frontend.serviceName,
            workflowPath: frontendWorkflowPath,
            status: 'provisioned',
            githubCommitSha: frontendPushResult.commitSha,
            githubCommitUrl: frontendPushResult.commitUrl,
            repoUrl,
            visibility: dto.visibility,
            repoShape: normalizeRepoShape(dto.repoShape),
            projectTypeId: frontend.projectTypeId,
            workflowRecipeId: frontend.workflowRecipeId ?? null,
            projectOptions: {
              workflowFiles: this.workflowFileMetadata(frontendWorkflowFiles),
            },
          });

          deploymentProvisioningResults.push(
            await this.projectDeploymentProvisioningService.provisionForProject(
              {
                projectId: frontendRow.id,
                userId,
                repoFullName,
                githubAccessToken: accessToken,
                request: this.filterDeploymentProvisioningRequest(
                  dto.deploymentProvisioning,
                  ['frontend'],
                ),
              },
            ),
          );
        } catch (err) {
          this.logger.warn(
            `Microservices project: frontend DB row save failed: ${String(err)}`,
          );
        }
      }

      await this.recordProductEvent({
        userId,
        projectId: backendRow.id,
        eventCode: 'project_created',
        title: 'Project created',
        body: `${repoFullName} is now tracked by FlowCI.`,
        metadata: {
          repoFullName,
          repoShape: 'microservices',
          projectTypeId: backend.projectTypeId,
        },
      });

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
    } catch (error) {
      if (!provisioningComplete) {
        await this.compensateFailedProvision(
          accessToken,
          ownerLogin,
          repoName,
          backendRow?.id,
          userId,
        );
      }
      throw error;
    }
  }

  // ─── POST /projects/setup ──────────────────────────────────────────────────

  async setupProject(
    userId: string,
    accessToken: string,
    dto: SetupProjectDto,
  ): Promise<SetupProjectResponse> {
    const deploymentSlots = this.resolveSingleRepoDeploymentSlots(
      dto.deploymentProvisioning,
    );

    // 1. Build workflow YAML from the given templateId
    const { workflowFiles, outputFileName } = await this.buildWorkflowBundle({
      templateId: dto.templateId,
      serviceName: dto.serviceName,
      servicePath: dto.servicePath,
      nodeVersion: dto.nodeVersion,
      coverageThreshold: dto.coverageThreshold,
      customOutputFileName: dto.outputFileName,
      enhancements: dto.enhancements,
      deploymentProvider: this.extractDeploymentProvider(
        dto.deploymentProvisioning,
        deploymentSlots[0] ?? 'standalone',
      ),
      deploymentTargets: this.resolveDeploymentWorkflowTargets(
        dto.deploymentProvisioning,
        deploymentSlots,
        dto.servicePath,
      ),
    });

    // 2. Derive owner and repo from repoFullName (format: "owner/repo")
    const [owner, repo] = this.parseRepoFullName(dto.repoFullName);

    // 3. Persist the project, issue the CI token, and install the Actions
    // secrets BEFORE pushing the workflow file so the access-gate's first run
    // on the existing repo can authenticate. Secrets are installed strictly so
    // a token without `secrets:write` aborts setup with a clear error.
    const workflowPath =
      workflowFiles[0]?.path ?? `.github/workflows/${outputFileName}`;

    const row = await this.projectsRepository.create({
      userId,
      workspaceId: await this.resolveDefaultWorkspaceId(userId),
      repoFullName: dto.repoFullName,
      templateId: dto.templateId,
      serviceName: dto.serviceName,
      workflowPath,
      status: 'provisioned',
      projectOptions: {
        workflowFiles: this.workflowFileMetadata(workflowFiles),
      },
    });

    let commitSha = '';
    let commitUrl: string | null = null;
    try {
      const ciToken = await this.ciService.issueProjectToken(row.id);
      await this.githubService.setActionsSecretStrict(
        accessToken,
        owner,
        repo,
        'CI_TOKEN',
        ciToken.token,
      );
      await this.githubService.setActionsSecretStrict(
        accessToken,
        owner,
        repo,
        'CI_REPORT_URL',
        CI_REPORT_URL,
      );

      // 4. Push workflow file to the existing repo's default branch (main) now
      // that the secrets exist, then record the commit.
      ({ commitSha, commitUrl } = await this.pushWorkflowFiles(
        accessToken,
        owner,
        repo,
        workflowFiles,
      ));
      await this.projectsRepository.updateStatus(
        row.id,
        'provisioned',
        commitSha,
        commitUrl,
      );
    } catch (error) {
      // The repo is the user's own existing repo — never delete it; just remove
      // the half-created tracking row so a retry starts clean.
      try {
        await this.projectsRepository.deleteByIdAndUser(row.id, userId);
      } catch (cleanupError) {
        this.logger.warn(
          `setupProject: failed to delete project row ${row.id}: ${String(cleanupError)}`,
        );
      }
      throw error;
    }

    const deploymentProvisioning =
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: row.id,
        userId,
        repoFullName: dto.repoFullName,
        githubAccessToken: accessToken,
        request: dto.deploymentProvisioning,
      });

    await this.recordProductEvent({
      userId,
      projectId: row.id,
      eventCode: 'project_created',
      title: 'Project created',
      body: `${dto.repoFullName} is now tracked by FlowCI.`,
      metadata: {
        repoFullName: dto.repoFullName,
        repoShape: 'existing',
        templateId: dto.templateId,
      },
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
    workspaceId?: string | null,
  ): Promise<ProvisionedProjectsResponse> {
    const rows = await this.projectsRepository.listByUser(
      userId,
      limit,
      workspaceId,
    );
    return {
      items: rows.map((row) => this.toProvisionedProject(row)),
    };
  }

  async getProjectOverview(
    projectId: string,
    userId: string,
  ): Promise<ProjectOverviewResponse> {
    const row = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!row) {
      throw new NotFoundException('Project not found');
    }

    const [
      ciToken,
      deploymentTargets,
      envMetadata,
      workflowHistory,
      latestSnapshot,
    ] = await Promise.all([
      this.loadCiTokenStatus(projectId),
      this.deploymentTargetsRepository?.listDeploymentTargets(projectId) ??
        Promise.resolve([]),
      this.envVarsRepository?.listEnvMetadata(projectId) ?? Promise.resolve([]),
      this.workflowHistoryRepository?.listForProjectIdentity({
        userId,
        serviceName: row.service_name,
        templateId: row.template_id,
        limit: 5,
      }) ?? Promise.resolve([]),
      this.dashboardSnapshotsRepository?.findLatestByProject(projectId) ??
        Promise.resolve(null),
    ]);

    const project = this.toProvisionedProject(row);
    const workflowFiles = project.workflowFiles ?? [];
    const matchingHistory = workflowHistory;
    const ciAuth = this.toCiAuthOverview(ciToken);
    const failedEnvCount = envMetadata.filter(
      (metadata) => metadata.status === 'failed',
    ).length;

    return {
      project: {
        ...project,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      workflow: {
        path: row.workflow_path,
        files: workflowFiles,
        stageCount: workflowFiles.length,
        history: matchingHistory,
      },
      deploymentTargets: {
        items: deploymentTargets,
        count: deploymentTargets.length,
      },
      environment: {
        items: envMetadata,
        count: envMetadata.length,
        failedCount: failedEnvCount,
      },
      ciAuth,
      health: this.buildOverviewHealth({
        project,
        workflowFiles,
        ciAuth,
        deploymentTargets,
        envMetadata,
      }),
      syncSnapshot: {
        enabled: this.projectSyncSnapshotsEnabled(),
        mode: 'local_snapshot',
        latest: latestSnapshot,
      },
      capabilities: {
        envProvisioning: true,
        workflowSettings: this.workflowSettingsPreviewEnabled(),
        syncSnapshots: this.projectSyncSnapshotsEnabled(),
        ciRunTracking: this.ciRunTrackingEnabled(),
        deploymentHistory: this.deploymentHistoryEnabled(),
        driftDetection: this.driftDetectionEnabled(),
      },
    };
  }

  // ─── DELETE /projects/:id ──────────────────────────────────────────────────

  /**
   * Removes a provisioned_projects record from FlowCI's database.
   * The GitHub repository, its workflow YAML files, and its GitHub Secrets
   * are NOT touched — this is a FlowCI tracking disconnect only.
   * CASCADE deletes ci.project_ci_tokens automatically via the FK.
   */
  async syncProjectSnapshot(
    projectId: string,
    userId: string,
  ): Promise<ProjectSyncSnapshotResponse> {
    if (!this.projectSyncSnapshotsEnabled()) {
      throw new BadRequestException('Project sync snapshots are disabled');
    }

    if (!this.dashboardSnapshotsRepository) {
      throw new ServiceUnavailableException(
        'Project dashboard snapshots are not configured',
      );
    }

    const startedAt = new Date().toISOString();
    const overview = await this.getProjectOverview(projectId, userId);
    const findings = this.buildLocalSnapshotFindings(overview);
    const completedAt = new Date().toISOString();
    const snapshot = await this.dashboardSnapshotsRepository.createSnapshot({
      projectId,
      status: overview.health.summary,
      summary: {
        mode: 'local_snapshot',
        projectId,
        healthSummary: overview.health.summary,
        workflowStageCount: overview.workflow.stageCount,
        deploymentTargetCount: overview.deploymentTargets.count,
        envVarCount: overview.environment.count,
        failedEnvVarCount: overview.environment.failedCount,
        ciTokenStatus: overview.ciAuth.status,
      },
      findings,
      startedAt,
      completedAt,
      createdBy: userId,
    });

    await this.recordProductEvent({
      userId,
      projectId,
      eventCode: 'project_snapshot_synced',
      title: 'Project snapshot synced',
      body: `Project snapshot completed with ${findings.length} finding${findings.length === 1 ? '' : 's'}.`,
      metadata: {
        snapshotId: snapshot.id,
        status: snapshot.status,
        findingCount: findings.length,
      },
    });

    return {
      snapshot,
      overview: {
        ...overview,
        syncSnapshot: {
          enabled: true,
          mode: 'local_snapshot',
          latest: snapshot,
        },
      },
    };
  }

  async listProjectAuditEvents(
    projectId: string,
    userId: string,
  ): Promise<ProjectAuditEventsResponse> {
    const project = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return (
      (await this.auditEventsService?.listProjectEvents(projectId, userId)) ?? {
        enabled: this.auditEventsEnabled(),
        items: [],
      }
    );
  }

  async getWorkflowSettings(
    projectId: string,
    userId: string,
  ): Promise<WorkflowSettingsResponse> {
    if (!this.workflowSettingsPreviewEnabled()) {
      throw new BadRequestException('Workflow settings preview is disabled');
    }

    const { row } = await this.loadOwnedProjectForWorkflowSettings(
      projectId,
      userId,
    );
    const storedSettings =
      await this.workflowSettingsRepository?.findByProject(projectId);

    if (storedSettings) {
      return {
        enabled: true,
        source: 'stored',
        settings: this.normalizeWorkflowSettings(row, storedSettings),
      };
    }

    return {
      enabled: true,
      source: 'project_options',
      settings: this.normalizeWorkflowSettings(row, null),
    };
  }

  async previewWorkflowSettings(
    projectId: string,
    userId: string,
    request: WorkflowSettingsPreviewRequest,
  ): Promise<WorkflowSettingsPreviewResponse> {
    if (!this.workflowSettingsPreviewEnabled()) {
      throw new BadRequestException('Workflow settings preview is disabled');
    }

    const { row, project } = await this.loadOwnedProjectForWorkflowSettings(
      projectId,
      userId,
    );
    const storedSettings =
      await this.workflowSettingsRepository?.findByProject(projectId);
    const settings = this.mergeWorkflowSettings(
      this.normalizeWorkflowSettings(row, storedSettings ?? null),
      request,
    );
    const validationWarnings = this.validateWorkflowSettingsPreview(
      settings,
      request,
    );

    if (validationWarnings.length > 0) {
      return {
        settings,
        workflowFiles: [],
        diffSummary: [],
        validationWarnings,
      };
    }

    const { workflowFiles } = await this.buildWorkflowBundle({
      templateId: settings.templateId,
      serviceName: settings.serviceName,
      servicePath: settings.servicePath,
      nodeVersion: settings.nodeVersion,
      coverageThreshold: settings.coverageThreshold,
      centralWorkflowRef: settings.centralWorkflowRef,
    });

    return {
      settings,
      workflowFiles,
      diffSummary: this.buildWorkflowPreviewDiff(
        project.workflowFiles ?? [],
        workflowFiles,
      ),
      validationWarnings: [],
    };
  }

  async createWorkflowUpdatePullRequest(
    projectId: string,
    userId: string,
    oauthAccessToken: string | null | undefined,
    request: WorkflowSettingsPreviewRequest,
  ): Promise<WorkflowUpdatePullRequestResponse> {
    if (!this.workflowUpdatePrEnabled()) {
      throw new BadRequestException(
        'Workflow update pull requests are disabled',
      );
    }
    await this.assertWithinQuota(userId, 'workflow_prs', 1, projectId);

    const { row, project } = await this.loadOwnedProjectForWorkflowSettings(
      projectId,
      userId,
    );
    const token = await this.resolveProvisioningToken(userId, oauthAccessToken);
    const [owner, repo] = this.parseRepoFullName(row.repo_full_name);
    const preview = await this.previewWorkflowSettings(
      projectId,
      userId,
      request,
    );

    if (preview.validationWarnings.length > 0) {
      throw new BadRequestException(
        preview.validationWarnings.map((warning) => warning.message).join(' '),
      );
    }

    const repoInfo = await this.githubService.getRepo(token, owner, repo);
    const baseBranch = repoInfo.defaultBranch || 'main';
    const branchName = `flowci/workflow-update-${this.timestampForBranch()}`;
    await this.githubService.createBranch(
      token,
      owner,
      repo,
      branchName,
      baseBranch,
    );

    for (const file of preview.workflowFiles) {
      await this.githubService.putFileContent(
        token,
        owner,
        repo,
        file.path,
        file.yaml,
        branchName,
        'ci: update FlowCI workflow configuration',
      );
    }

    let pullRequest: { number: number; htmlUrl: string };
    try {
      pullRequest = await this.githubService.createPullRequest(
        token,
        owner,
        repo,
        {
          title: 'Update FlowCI workflow configuration',
          head: branchName,
          base: baseBranch,
          body: this.buildWorkflowUpdatePullRequestBody(preview),
        },
      );
    } catch (error) {
      throw new BadRequestException(
        'GitHub could not create the workflow update pull request. Check repository permissions and whether an update PR already exists.',
        { cause: error },
      );
    }

    const workflowFiles = preview.workflowFiles.map((file) => ({
      stage: file.stage,
      name: file.name,
      path: file.path,
      gated: file.gated,
    }));
    const persistedRequest =
      (await this.workflowUpdateRequestsRepository?.createRequest({
        projectId,
        requestedBy: userId,
        branchName,
        baseBranch,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.htmlUrl,
        status: 'created',
        settings: preview.settings as unknown as Record<string, unknown>,
        workflowFiles,
      })) ?? null;

    await this.auditEventsService?.recordProjectEvent({
      actorUserId: userId,
      projectId,
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: {
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.htmlUrl,
        branchName,
        baseBranch,
      },
    });

    await this.notificationEventsService?.record({
      userId,
      projectId,
      eventCode: 'workflow_pr_created',
      title: 'Workflow update PR created',
      body: `Workflow update PR #${pullRequest.number} was created for ${project.repoFullName}.`,
    });

    return {
      projectId,
      repoFullName: project.repoFullName,
      branchName,
      workflowPath: preview.workflowFiles[0]?.path ?? row.workflow_path,
      workflowFiles,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.htmlUrl,
      status: 'created',
      request: persistedRequest,
    };
  }

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
      await this.recordProductEvent({
        userId,
        projectId: null,
        eventCode: 'project_sync_completed',
        title: 'Project sync completed',
        body: 'Project repository sync found no tracked projects.',
        metadata: { orphaned: 0, reachable: 0, total: 0 },
      });
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

    await this.recordProductEvent({
      userId,
      projectId: null,
      eventCode: 'project_sync_completed',
      title: 'Project sync completed',
      body: `Project repository sync checked ${rows.length} tracked project${rows.length === 1 ? '' : 's'}.`,
      metadata: {
        orphaned: orphanedCount,
        reachable: reachableCount,
        total: rows.length,
      },
    });

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
      ...(request.variableGroups
        ? { variableGroups: request.variableGroups }
        : {}),
      ...(request.sharedEnv ? { sharedEnv: request.sharedEnv } : {}),
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

  private extractDeploymentProvider(
    request: DeploymentProvisioningRequestDto | undefined,
    slot: DeploymentProvisioningTargetDto['slot'],
  ): DeploymentProvider | undefined {
    if (!request?.enabled || !request.targets?.length) return undefined;
    const provider = request.targets.find((t) => t.slot === slot)?.provider;
    return provider === 'render' ? provider : undefined;
  }

  private resolveDeploymentWorkflowTargets(
    request: DeploymentProvisioningRequestDto | undefined,
    slots: DeploymentProvisioningTargetDto['slot'][],
    fallbackRootDirectory?: string,
  ): DeploymentWorkflowTarget[] {
    if (!request?.enabled || !request.targets?.length) {
      return [];
    }

    return request.targets
      .filter((target) => slots.includes(target.slot))
      .filter(
        (target) =>
          target.provider === 'vercel' ||
          (target.provider === 'render' &&
            this.resolveRenderDeploymentStrategy(target) ===
              'render_image_pushed'),
      )
      .map((target) => {
        const rootDirectory = this.resolveWorkflowRootDirectory(
          target,
          fallbackRootDirectory,
        );
        if (target.provider === 'render') {
          const descriptor: DeploymentWorkflowTarget = {
            slot: target.slot,
            provider: 'render',
            deploymentStrategy: 'render_image_pushed',
            secretNames: this.renderSecretNames(target.slot),
            dockerContext: target.dockerContext?.trim() || rootDirectory || '.',
            dockerfilePath: target.dockerfilePath?.trim() || 'Dockerfile',
            imageName: this.renderImageName(target),
            renderServiceType: target.renderServiceType ?? 'web_service',
            renderInstanceType: target.renderInstanceType ?? 'free',
          };
          if (rootDirectory) {
            descriptor.rootDirectory = rootDirectory;
          }

          return descriptor;
        }

        const descriptor: DeploymentWorkflowTarget = {
          slot: target.slot,
          provider: 'vercel',
          deploymentStrategy: 'vercel_ci_pushed',
          secretNames: this.vercelSecretNames(target.slot),
        };
        if (rootDirectory) {
          descriptor.rootDirectory = rootDirectory;
        }

        return descriptor;
      });
  }

  private resolveRenderDeploymentStrategy(
    target: DeploymentProvisioningTargetDto,
  ):
    | 'render_image_pushed'
    | 'render_git_connected'
    | 'render_existing_service' {
    if (target.renderDeployMethod === 'existing_service') {
      return 'render_existing_service';
    }
    if (
      target.ownershipMode === 'flowci_managed' ||
      target.renderDeployMethod === 'byo_image'
    ) {
      return 'render_image_pushed';
    }

    return 'render_git_connected';
  }

  private resolveWorkflowRootDirectory(
    target: DeploymentProvisioningTargetDto,
    fallbackRootDirectory?: string,
  ): string | undefined {
    const rootDirectory = target.rootDirectory?.trim();
    if (rootDirectory) {
      return rootDirectory;
    }

    return fallbackRootDirectory?.trim() || undefined;
  }

  private vercelSecretNames(
    slot: DeploymentProvisioningTargetDto['slot'],
  ): NonNullable<DeploymentWorkflowTarget['secretNames']> {
    const prefix = `VERCEL_${slot.toUpperCase()}`;
    return {
      token: `${prefix}_TOKEN`,
      orgId: `${prefix}_ORG_ID`,
      projectId: `${prefix}_PROJECT_ID`,
    };
  }

  private renderSecretNames(
    slot: DeploymentProvisioningTargetDto['slot'],
  ): NonNullable<DeploymentWorkflowTarget['secretNames']> {
    const prefix = `RENDER_${slot.toUpperCase()}`;
    return {
      apiKey: `${prefix}_API_KEY`,
      serviceId: `${prefix}_SERVICE_ID`,
      ownerId: `${prefix}_OWNER_ID`,
      registryCredentialId: `${prefix}_REGISTRY_CREDENTIAL_ID`,
    };
  }

  private renderImageName(target: DeploymentProvisioningTargetDto): string {
    const raw = `flowci-${target.slot}-${target.projectName ?? target.slot}`;
    return raw
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }

  private resolveSingleRepoDeploymentSlots(
    request: DeploymentProvisioningRequestDto | undefined,
  ): DeploymentProvisioningTargetDto['slot'][] {
    if (!request?.enabled || !request.targets?.length) {
      return ['standalone'];
    }

    const slots = request.targets
      .map((target) => target.slot)
      .filter((slot): slot is DeploymentProvisioningTargetDto['slot'] =>
        ['standalone', 'frontend', 'backend'].includes(slot),
      );

    return slots.length > 0 ? Array.from(new Set(slots)) : ['standalone'];
  }

  private async buildWorkflowBundle(options: {
    templateId: string;
    serviceName: string;
    servicePath?: string | undefined;
    nodeVersion?: string | undefined;
    coverageThreshold?: number | undefined;
    customOutputFileName?: string | undefined;
    enhancements?:
      | Array<
          | 'strictProductionApproval'
          | 'enableUatApproval'
          | 'disablePlaywright'
          | 'disableK6'
        >
      | undefined;
    deploymentProvider?: DeploymentProvider | undefined;
    deploymentTargets?: DeploymentWorkflowTarget[] | undefined;
    workflowVariant?: 'backend' | 'frontend' | undefined;
    centralWorkflowRef?: string | undefined;
  }): Promise<{ workflowFiles: StagedWorkflowFile[]; outputFileName: string }> {
    const {
      templateId,
      serviceName,
      servicePath,
      nodeVersion,
      coverageThreshold,
      customOutputFileName,
      enhancements,
      deploymentProvider,
      deploymentTargets = [],
      workflowVariant,
      centralWorkflowRef,
    } = options;

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
      ...(deploymentProvider !== undefined && { deploymentProvider }),
      ...(deploymentTargets.length > 0 && { deploymentTargets }),
      ...(workflowVariant !== undefined && { workflowVariant }),
      ...(centralWorkflowRef !== undefined && { centralWorkflowRef }),
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
      includeDocker?: boolean;
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
      includeDocker: opts.includeDocker ?? defaultIncludeDocker(stack),
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
      '| Branch  | Purpose |',
      '|---------|---------|',
      '| main    | Stable baseline — protected |',
      '| uat     | Pre-production gate — protected |',
      '| test    | Integration target — protected |',
      '| develop | Staging/integration branch — protected, no CI pipeline |',
      '',
      '## CI/CD',
      '',
      'Workflow files live in `.github/workflows/`. The CI pipeline runs on `test`, `uat`, and `main` only; `develop` is a protected staging branch with no pipeline. Push to `test` to trigger your first run.',
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
    // Each repo carries a flat standalone scaffold, so the workflow always
    // runs at the repo root — slot servicePaths like 'backend/' only apply to
    // single-repo shapes and would point at a directory that does not exist.
    const {
      workflowFiles: backendWorkflowFiles,
      outputFileName: backendOutputFileName,
    } = await this.buildWorkflowBundle({
      templateId: backendTemplateId,
      serviceName: backend.serviceName,
      servicePath: '.',
      nodeVersion: dto.nodeVersion,
      coverageThreshold: dto.coverageThreshold,
      deploymentProvider: this.extractDeploymentProvider(
        dto.deploymentProvisioning,
        'backend',
      ),
      deploymentTargets: this.resolveDeploymentWorkflowTargets(
        dto.deploymentProvisioning,
        ['backend'],
        '.',
      ),
    });

    const {
      repoUrl: beRepoUrl,
      ownerLogin,
      repoName: actualBeRepoName,
    } = await this.githubService.createRepo(accessToken, {
      repoName: beRepoName,
      private: dto.visibility === 'private',
    });

    const beRepoFullName = `${ownerLogin}/${actualBeRepoName}`;
    const backendWorkflowPath =
      backendWorkflowFiles[0]?.path ??
      `.github/workflows/${backendOutputFileName}`;

    let backendRow: ProvisionedProjectRow | undefined;
    let backendCommitSha = '';
    let backendCommitUrl: string | null = null;
    let backendProvisioningComplete = false;
    try {
      await this.pushStarterFiles(accessToken, ownerLogin, actualBeRepoName, {
        projectName: backend.serviceName || actualBeRepoName,
        stack: backend.projectTypeId,
        repoShape: 'standalone',
        ...(dto.tests?.['docker'] !== undefined && {
          includeDocker: dto.tests['docker'],
        }),
      });

      // Persist + token + secrets before the workflow push so the first
      // access-gate run can authenticate (see createProject for rationale).
      backendRow = await this.projectsRepository.create({
        userId,
        workspaceId: await this.resolveDefaultWorkspaceId(userId),
        repoFullName: beRepoFullName,
        templateId: backendTemplateId,
        serviceName: backend.serviceName,
        workflowPath: backendWorkflowPath,
        status: 'provisioned',
        repoUrl: beRepoUrl,
        visibility: dto.visibility,
        repoShape: normalizeRepoShape(dto.repoShape),
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
      await this.githubService.setActionsSecretStrict(
        accessToken,
        ownerLogin,
        actualBeRepoName,
        'CI_TOKEN',
        backendCiToken.token,
      );
      await this.githubService.setActionsSecretStrict(
        accessToken,
        ownerLogin,
        actualBeRepoName,
        'CI_REPORT_URL',
        CI_REPORT_URL,
      );

      ({ commitSha: backendCommitSha, commitUrl: backendCommitUrl } =
        await this.pushWorkflowFiles(
          accessToken,
          ownerLogin,
          actualBeRepoName,
          backendWorkflowFiles,
        ));
      await this.projectsRepository.updateStatus(
        backendRow.id,
        'provisioned',
        backendCommitSha,
        backendCommitUrl,
      );

      // `develop` is created and protected like the rest, but no CI runs on
      // it (pipeline triggers stay test/uat/main only).
      for (const branch of ['develop', 'uat', 'test'] as const) {
        await this.githubService.createBranch(
          accessToken,
          ownerLogin,
          actualBeRepoName,
          branch,
          'main',
        );
      }

      for (const branch of ['develop', 'test', 'uat', 'main'] as const) {
        await this.githubService.applyBranchProtection(
          accessToken,
          ownerLogin,
          actualBeRepoName,
          branch,
        );
      }

      backendProvisioningComplete = true;
    } catch (error) {
      if (!backendProvisioningComplete) {
        await this.compensateFailedProvision(
          accessToken,
          ownerLogin,
          actualBeRepoName,
          backendRow?.id,
          userId,
        );
      }
      throw error;
    }

    if (!backendRow) {
      // Unreachable: a backend failure is rethrown from the catch above.
      throw new UnprocessableEntityException(
        'Backend repository provisioning did not complete',
      );
    }

    // ── Frontend repository (non-fatal on failure) ──────────────────────────

    const deploymentProvisioningResults: DeploymentProvisioningResult[] = [
      await this.projectDeploymentProvisioningService.provisionForProject({
        projectId: backendRow.id,
        userId,
        repoFullName: beRepoFullName,
        githubAccessToken: accessToken,
        request: this.filterDeploymentProvisioningRequest(
          dto.deploymentProvisioning,
          ['backend'],
        ),
      }),
    ];

    let feRepoFullName: string | undefined;
    let feRepoUrl: string | undefined;
    let feRepoCreated: { owner: string; repo: string } | undefined;
    let feRow: ProvisionedProjectRow | undefined;
    let feProvisioningComplete = false;

    try {
      const frontendTemplateId = this.resolveTemplateId(
        frontend.projectTypeId,
        frontend.workflowRecipeId,
      );
      const {
        workflowFiles: frontendWorkflowFiles,
        outputFileName: frontendOutputFileName,
      } = await this.buildWorkflowBundle({
        templateId: frontendTemplateId,
        serviceName: frontend.serviceName,
        servicePath: '.',
        nodeVersion: dto.nodeVersion,
        coverageThreshold: dto.coverageThreshold,
        deploymentProvider: this.extractDeploymentProvider(
          dto.deploymentProvisioning,
          'frontend',
        ),
        deploymentTargets: this.resolveDeploymentWorkflowTargets(
          dto.deploymentProvisioning,
          ['frontend'],
          '.',
        ),
      });

      const {
        repoUrl: resolvedFeRepoUrl,
        ownerLogin: feOwnerLogin,
        repoName: actualFeRepoName,
      } = await this.githubService.createRepo(accessToken, {
        repoName: feRepoName,
        private: dto.visibility === 'private',
      });

      feRepoCreated = { owner: feOwnerLogin, repo: actualFeRepoName };
      feRepoFullName = `${feOwnerLogin}/${actualFeRepoName}`;
      feRepoUrl = resolvedFeRepoUrl;

      await this.pushStarterFiles(accessToken, feOwnerLogin, actualFeRepoName, {
        projectName: frontend.serviceName || actualFeRepoName,
        stack: frontend.projectTypeId,
        repoShape: 'standalone',
        ...(dto.tests?.['docker'] !== undefined && {
          includeDocker: dto.tests['docker'],
        }),
      });

      const frontendWorkflowPath =
        frontendWorkflowFiles[0]?.path ??
        `.github/workflows/${frontendOutputFileName}`;

      feRow = await this.projectsRepository.create({
        userId,
        workspaceId: await this.resolveDefaultWorkspaceId(userId),
        repoFullName: feRepoFullName,
        templateId: frontendTemplateId,
        serviceName: frontend.serviceName,
        workflowPath: frontendWorkflowPath,
        status: 'provisioned',
        repoUrl: feRepoUrl,
        visibility: dto.visibility,
        repoShape: normalizeRepoShape(dto.repoShape),
        projectTypeId: frontend.projectTypeId,
        workflowRecipeId: frontend.workflowRecipeId ?? null,
        projectOptions: {
          workflowFiles: this.workflowFileMetadata(frontendWorkflowFiles),
        },
      });

      const frontendCiToken = await this.ciService.issueProjectToken(feRow.id);
      await this.githubService.setActionsSecretStrict(
        accessToken,
        feOwnerLogin,
        actualFeRepoName,
        'CI_TOKEN',
        frontendCiToken.token,
      );
      await this.githubService.setActionsSecretStrict(
        accessToken,
        feOwnerLogin,
        actualFeRepoName,
        'CI_REPORT_URL',
        CI_REPORT_URL,
      );

      const { commitSha: frontendCommitSha, commitUrl: frontendCommitUrl } =
        await this.pushWorkflowFiles(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          frontendWorkflowFiles,
        );
      await this.projectsRepository.updateStatus(
        feRow.id,
        'provisioned',
        frontendCommitSha,
        frontendCommitUrl,
      );

      // `develop` is created and protected like the rest, but no CI runs on
      // it (pipeline triggers stay test/uat/main only).
      for (const branch of ['develop', 'uat', 'test'] as const) {
        await this.githubService.createBranch(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          branch,
          'main',
        );
      }

      for (const branch of ['develop', 'test', 'uat', 'main'] as const) {
        await this.githubService.applyBranchProtection(
          accessToken,
          feOwnerLogin,
          actualFeRepoName,
          branch,
        );
      }

      feProvisioningComplete = true;

      deploymentProvisioningResults.push(
        await this.projectDeploymentProvisioningService.provisionForProject({
          projectId: feRow.id,
          userId,
          repoFullName: feRepoFullName,
          githubAccessToken: accessToken,
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
      // Roll back a half-created frontend repo so a retry can reuse its name;
      // the backend repo is fully provisioned and is still returned.
      if (!feProvisioningComplete && feRepoCreated) {
        await this.compensateFailedProvision(
          accessToken,
          feRepoCreated.owner,
          feRepoCreated.repo,
          feRow?.id,
          userId,
        );
        feRepoFullName = undefined;
        feRepoUrl = undefined;
      }
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

  private async loadCiTokenStatus(
    projectId: string,
  ): Promise<ProjectTokenStatus | null> {
    if (!this.ciTokensRepository) {
      return null;
    }

    return this.ciTokensRepository.findProjectTokenStatus(projectId);
  }

  private async loadOwnedProjectForWorkflowSettings(
    projectId: string,
    userId: string,
  ): Promise<{ row: ProvisionedProjectRow; project: ProvisionedProject }> {
    const row = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!row) {
      throw new NotFoundException('Project not found');
    }

    return {
      row,
      project: this.toProvisionedProject(row),
    };
  }

  private async resolveDefaultWorkspaceId(
    userId: string,
  ): Promise<string | null> {
    const workspaces = await this.workspacesService?.getMyWorkspaces(userId);
    return workspaces?.items[0]?.id ?? null;
  }

  /**
   * Best-effort cleanup after a provisioning failure: removes the half-created
   * DB row and the orphaned GitHub repo so a retry with the same name can
   * succeed. Never throws — compensation failures are logged so they cannot
   * mask the original provisioning error.
   */
  private async compensateFailedProvision(
    accessToken: string,
    owner: string,
    repo: string,
    projectId: string | undefined,
    userId: string,
  ): Promise<void> {
    if (projectId) {
      try {
        await this.projectsRepository.deleteByIdAndUser(projectId, userId);
      } catch (error) {
        this.logger.warn(
          `Compensation: failed to delete project row ${projectId}: ${String(error)}`,
        );
      }
    }
    await this.githubService.deleteRepo(accessToken, owner, repo);
  }

  private async assertWithinQuota(
    userId: string,
    limitCode: UsageLimitCode,
    increment: number,
    projectId: string | null,
  ): Promise<void> {
    try {
      await this.usageQuotaService?.assertWithinLimit(
        userId,
        limitCode,
        increment,
      );
    } catch (error) {
      await this.recordProductEvent({
        userId,
        projectId,
        eventCode: 'quota_blocked',
        title: 'Quota blocked action',
        body: `Quota ${limitCode} blocked this action.`,
        metadata: {
          limitCode,
          increment,
        },
      });
      throw error;
    }
  }

  private async recordProductEvent(input: {
    userId: string;
    projectId: string | null;
    eventCode: string;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.auditEventsService?.recordProjectEvent({
      actorUserId: input.userId,
      projectId: input.projectId,
      eventCode: input.eventCode,
      message: input.title,
      metadata: input.metadata,
    });
    await this.notificationEventsService?.record({
      userId: input.userId,
      projectId: input.projectId,
      eventCode: input.eventCode,
      title: input.title,
      body: input.body,
    });
  }

  private projectSyncSnapshotsEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.projectSyncSnapshots.enabled ?? false;
  }

  private workflowSettingsPreviewEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.workflowSettingsPreview.enabled ?? false;
  }

  private workflowUpdatePrEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.workflowUpdatePr.enabled ?? false;
  }

  private ciRunTrackingEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.ciRunTracking?.enabled ?? false;
  }

  private deploymentHistoryEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.deploymentHistory?.enabled ?? false;
  }

  private driftDetectionEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.driftDetection?.enabled ?? false;
  }

  private auditEventsEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.auditEvents?.enabled ?? false;
  }

  private timestampForBranch(date = new Date()): string {
    return date.toISOString().replaceAll(/\D/g, '').slice(0, 14);
  }

  private buildWorkflowUpdatePullRequestBody(
    preview: WorkflowSettingsPreviewResponse,
  ): string {
    const fileList = preview.workflowFiles
      .map((file) => `- ${file.path}`)
      .join('\n');
    const changedSettings = [
      `Node version: ${preview.settings.nodeVersion}`,
      `Coverage threshold: ${String(preview.settings.coverageThreshold)}`,
      `Service path: ${preview.settings.servicePath}`,
      `Central workflow ref: ${preview.settings.centralWorkflowRef}`,
    ].join('\n');

    return [
      'This PR updates the FlowCI workflow configuration for this project.',
      '',
      'Changed settings:',
      changedSettings,
      '',
      'Generated workflow files:',
      fileList,
      '',
      'Runtime environment values are not included.',
    ].join('\n');
  }

  private normalizeWorkflowSettings(
    row: ProvisionedProjectRow,
    stored: ProjectWorkflowSettingsRowValue | null,
  ): WorkflowSettings {
    const storedSettings = stored?.settings ?? {};
    const projectOptions = row.project_options ?? {};
    const checks = this.readChecks(projectOptions, storedSettings);

    return {
      projectId: row.id,
      templateId:
        this.readString(storedSettings['templateId']) ?? row.template_id,
      projectTypeId:
        this.readNullableString(storedSettings['projectTypeId']) ??
        row.project_type_id,
      workflowRecipeId:
        this.readNullableString(storedSettings['workflowRecipeId']) ??
        row.workflow_recipe_id,
      serviceName:
        this.readString(storedSettings['serviceName']) ?? row.service_name,
      servicePath:
        this.readString(storedSettings['servicePath']) ??
        this.readString(projectOptions['servicePath']) ??
        '.',
      nodeVersion:
        this.readString(storedSettings['nodeVersion']) ??
        this.readString(projectOptions['nodeVersion']) ??
        '24',
      packageManager: 'npm',
      coverageThreshold:
        this.readNumber(storedSettings['coverageThreshold']) ??
        this.readNumber(projectOptions['coverageThreshold']) ??
        80,
      centralWorkflowRef:
        this.readString(storedSettings['centralWorkflowRef']) ?? 'v1',
      checks,
    };
  }

  private mergeWorkflowSettings(
    base: WorkflowSettings,
    request: WorkflowSettingsPreviewRequest,
  ): WorkflowSettings {
    return {
      ...base,
      ...(request.templateId !== undefined && {
        templateId: request.templateId,
      }),
      ...(request.projectTypeId !== undefined && {
        projectTypeId: request.projectTypeId,
      }),
      ...(request.workflowRecipeId !== undefined && {
        workflowRecipeId: request.workflowRecipeId,
      }),
      ...(request.serviceName !== undefined && {
        serviceName: request.serviceName,
      }),
      ...(request.servicePath !== undefined && {
        servicePath: request.servicePath,
      }),
      ...(request.nodeVersion !== undefined && {
        nodeVersion: request.nodeVersion,
      }),
      packageManager: 'npm',
      ...(request.coverageThreshold !== undefined && {
        coverageThreshold: request.coverageThreshold,
      }),
      ...(request.centralWorkflowRef !== undefined && {
        centralWorkflowRef: request.centralWorkflowRef,
      }),
      checks: {
        ...base.checks,
        ...(request.checks ?? {}),
      },
    };
  }

  private validateWorkflowSettingsPreview(
    settings: WorkflowSettings,
    request: WorkflowSettingsPreviewRequest,
  ): WorkflowSettingsPreviewResponse['validationWarnings'] {
    const warnings: WorkflowSettingsPreviewResponse['validationWarnings'] = [];

    if (
      !Number.isInteger(settings.coverageThreshold) ||
      settings.coverageThreshold < 0 ||
      settings.coverageThreshold > 100
    ) {
      warnings.push({
        field: 'coverageThreshold',
        message: 'Coverage threshold must be between 0 and 100.',
      });
    }

    if (
      request.packageManager !== undefined &&
      request.packageManager !== 'npm'
    ) {
      warnings.push({
        field: 'packageManager',
        message: 'Only npm workflow previews are supported in this phase.',
      });
    }

    if (!/^[0-9]{2}$/.test(settings.nodeVersion)) {
      warnings.push({
        field: 'nodeVersion',
        message: 'Node version must be a two-digit major version.',
      });
    }

    return warnings;
  }

  private buildWorkflowPreviewDiff(
    currentFiles: WorkflowFileMetadata[],
    previewFiles: StagedWorkflowFile[],
  ): WorkflowSettingsPreviewResponse['diffSummary'] {
    const currentPaths = new Set(currentFiles.map((file) => file.path));

    return previewFiles.map((file) => ({
      path: file.path,
      status:
        currentPaths.size === 0
          ? 'new'
          : currentPaths.has(file.path)
            ? 'changed'
            : 'new',
    }));
  }

  private readChecks(
    projectOptions: Record<string, unknown>,
    storedSettings: Record<string, unknown>,
  ): WorkflowSettings['checks'] {
    const storedChecks =
      typeof storedSettings['checks'] === 'object' &&
      storedSettings['checks'] !== null &&
      !Array.isArray(storedSettings['checks'])
        ? (storedSettings['checks'] as Record<string, unknown>)
        : {};
    const optionTests =
      typeof projectOptions['tests'] === 'object' &&
      projectOptions['tests'] !== null &&
      !Array.isArray(projectOptions['tests'])
        ? (projectOptions['tests'] as Record<string, unknown>)
        : {};

    return {
      lint:
        this.readBoolean(storedChecks['lint']) ??
        this.readBoolean(optionTests['lint']) ??
        true,
      unit:
        this.readBoolean(storedChecks['unit']) ??
        this.readBoolean(optionTests['unit']) ??
        true,
      build:
        this.readBoolean(storedChecks['build']) ??
        this.readBoolean(optionTests['build']) ??
        true,
      security:
        this.readBoolean(storedChecks['security']) ??
        this.readBoolean(optionTests['security']) ??
        true,
    };
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private readNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private buildLocalSnapshotFindings(
    overview: ProjectOverviewResponse,
  ): ProjectDashboardSnapshotFinding[] {
    const findings: ProjectDashboardSnapshotFinding[] = [];

    if (overview.workflow.stageCount === 0) {
      findings.push({
        code: 'workflow_files_missing',
        severity: 'warning',
        message: 'No workflow file metadata is tracked yet.',
        source: 'local_snapshot',
      });
    }

    if (overview.deploymentTargets.count === 0) {
      findings.push({
        code: 'deployment_target_not_provisioned',
        severity: 'warning',
        message: 'No deployment targets are configured.',
        source: 'local_snapshot',
      });
    }

    if (overview.ciAuth.status === 'missing') {
      findings.push({
        code: 'ci_token_missing',
        severity: 'warning',
        message: 'No project CI token is tracked.',
        source: 'local_snapshot',
      });
    }

    if (overview.ciAuth.status === 'revoked') {
      findings.push({
        code: 'ci_token_revoked',
        severity: 'warning',
        message: 'Project CI token is revoked.',
        source: 'local_snapshot',
      });
    }

    if (overview.environment.count === 0) {
      findings.push({
        code: 'env_metadata_empty',
        severity: 'warning',
        message: 'No env var metadata is tracked yet.',
        source: 'local_snapshot',
      });
    }

    for (const check of overview.health.checks) {
      if (check.status === 'error') {
        findings.push({
          code: check.key,
          severity: 'error',
          message: check.message,
          source: 'local_snapshot',
        });
      }
    }

    return findings;
  }

  private toCiAuthOverview(token: ProjectTokenStatus | null): {
    status: 'active' | 'revoked' | 'missing';
    tokenPresent: boolean;
    tokenPrefix: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    revokedAt: string | null;
  } {
    if (!token) {
      return {
        status: 'missing',
        tokenPresent: false,
        tokenPrefix: null,
        createdAt: null,
        updatedAt: null,
        revokedAt: null,
      };
    }

    return {
      status: token.status,
      tokenPresent: true,
      tokenPrefix: token.tokenPrefix,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      revokedAt: token.revokedAt,
    };
  }

  private buildOverviewHealth(input: {
    project: ProvisionedProject;
    workflowFiles: WorkflowFileMetadata[];
    ciAuth: ProjectOverviewResponse['ciAuth'];
    deploymentTargets: DeploymentTargetSummary[];
    envMetadata: EnvVarMetadata[];
  }): ProjectOverviewResponse['health'] {
    const checks: ProjectOverviewResponse['health']['checks'] = [
      {
        key: 'project_status',
        label: 'Project status',
        status: input.project.status === 'failed' ? 'error' : 'ok',
        message:
          input.project.status === 'failed'
            ? (input.project.failureReason ?? 'Project provisioning failed.')
            : `Project is ${input.project.status}.`,
      },
      {
        key: 'workflow_bundle',
        label: 'Workflow bundle',
        status: input.workflowFiles.length > 0 ? 'ok' : 'warning',
        message:
          input.workflowFiles.length > 0
            ? `${input.workflowFiles.length} workflow file${input.workflowFiles.length === 1 ? '' : 's'} tracked.`
            : 'No workflow file metadata is tracked yet.',
      },
      {
        key: 'ci_token',
        label: 'CI token',
        status: input.ciAuth.status === 'active' ? 'ok' : 'warning',
        message:
          input.ciAuth.status === 'active'
            ? 'Project CI token is active.'
            : input.ciAuth.status === 'revoked'
              ? 'Project CI token is revoked.'
              : 'No project CI token is tracked.',
      },
      {
        key: 'deployment_targets',
        label: 'Deployment targets',
        status: input.deploymentTargets.length > 0 ? 'ok' : 'warning',
        message:
          input.deploymentTargets.length > 0
            ? `${input.deploymentTargets.length} deployment target${input.deploymentTargets.length === 1 ? '' : 's'} tracked.`
            : 'No deployment targets are configured.',
      },
      {
        key: 'env_metadata',
        label: 'Environment metadata',
        status: input.envMetadata.some((item) => item.status === 'failed')
          ? 'warning'
          : 'ok',
        message:
          input.envMetadata.length > 0
            ? `${input.envMetadata.length} env var key${input.envMetadata.length === 1 ? '' : 's'} tracked.`
            : 'No env var metadata is tracked yet.',
      },
    ];
    const summary = checks.some((check) => check.status === 'error')
      ? 'error'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'ok';

    return { summary, checks };
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
      isExample: row.is_example ?? false,
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
