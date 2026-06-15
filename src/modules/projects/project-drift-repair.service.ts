import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { CiService } from '../ci/ci.service';
import { DeploymentTargetsRepository } from '../env-provisioning/deployment-targets.repository';
import type {
  ProjectDriftFinding,
  ProjectDriftRepairAction,
  ProjectDriftRepairResponse,
} from './project-drift.types';
import { ProjectSyncFindingsRepository } from './project-sync-findings.repository';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

@Injectable()
export class ProjectDriftRepairService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly findingsRepository: ProjectSyncFindingsRepository,
    private readonly ciService: CiService,
    @Optional()
    private readonly deploymentTargetsRepository?: DeploymentTargetsRepository,
    @Optional()
    private readonly projectsService?: ProjectsService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async repair(
    projectId: string,
    findingId: string,
    userId: string,
    action: ProjectDriftRepairAction,
    githubAccessToken: string | null,
  ): Promise<ProjectDriftRepairResponse> {
    const project = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!this.enabled()) {
      return this.disabled(findingId, action, 'Drift repair is disabled');
    }

    const finding = await this.findingsRepository.findByIdForProject(
      projectId,
      findingId,
    );
    if (!finding) {
      throw new NotFoundException('Drift finding not found');
    }
    if (finding.status !== 'active') {
      throw new BadRequestException('Drift finding is not active');
    }

    if (this.requiresLiveProvider(finding)) {
      return this.disabled(
        findingId,
        action,
        'Live provider activation required',
      );
    }

    if (action === 'mark_ignored') {
      await this.findingsRepository.markStatus(findingId, 'ignored');
      return this.completed(findingId, action, 'Finding marked ignored');
    }

    if (action === 'rotate_ci_token') {
      this.assertCode(finding, ['ci_token_missing', 'ci_token_revoked'], action);
      const result = await this.ciService.issueProjectToken(projectId);
      await this.findingsRepository.markStatus(findingId, 'resolved');
      return this.completed(findingId, action, 'CI token rotated in FlowCI', {
        tokenPrefix: result.tokenPrefix,
      });
    }

    if (action === 'detach_target') {
      this.assertCode(
        finding,
        ['deployment_target_metadata_missing', 'provider_target_missing_live'],
        action,
      );
      if (!finding.targetId) {
        throw new BadRequestException('Finding is not associated with a target');
      }
      const detached =
        await this.deploymentTargetsRepository?.deleteDeploymentTargetForUser(
          projectId,
          finding.targetId,
          userId,
        );
      if (!detached) {
        throw new NotFoundException('Deployment target not found');
      }
      await this.findingsRepository.markStatus(findingId, 'resolved');
      return this.completed(
        findingId,
        action,
        'Deployment target detached from FlowCI',
        { targetId: finding.targetId },
      );
    }

    if (action === 'regenerate_workflow_preview') {
      this.assertCode(
        finding,
        ['workflow_files_missing', 'central_workflow_ref_outdated'],
        action,
      );
      const preview = await this.projectsService?.previewWorkflowSettings(
        projectId,
        userId,
        {},
      );
      return this.completed(
        findingId,
        action,
        'Workflow preview regenerated',
        {
          workflowFiles: preview?.workflowFiles ?? [],
          validationWarnings: preview?.validationWarnings ?? [],
        },
      );
    }

    if (action === 'create_workflow_update_pr') {
      this.assertCode(
        finding,
        ['workflow_files_missing', 'central_workflow_ref_outdated'],
        action,
      );
      if (!this.workflowUpdatePrEnabled()) {
        return this.disabled(
          findingId,
          action,
          'Workflow update PR creation is disabled',
        );
      }
      const pullRequest =
        await this.projectsService?.createWorkflowUpdatePullRequest(
          projectId,
          userId,
          githubAccessToken,
          {},
        );
      await this.findingsRepository.markStatus(findingId, 'resolved');
      return this.completed(findingId, action, 'Workflow update PR created', {
        pullRequestUrl: pullRequest?.pullRequestUrl ?? null,
        pullRequestNumber: pullRequest?.pullRequestNumber ?? null,
      });
    }

    throw new BadRequestException('Unsupported repair action');
  }

  private enabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.driftRepair?.enabled ?? false;
  }

  private workflowUpdatePrEnabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.workflowUpdatePr?.enabled ?? false;
  }

  private requiresLiveProvider(finding: ProjectDriftFinding): boolean {
    return [
      'github_repo_unreachable',
      'github_secret_missing',
      'provider_env_key_missing_live',
      'provider_target_missing_live',
    ].includes(finding.code);
  }

  private assertCode(
    finding: ProjectDriftFinding,
    supportedCodes: string[],
    action: ProjectDriftRepairAction,
  ) {
    if (!supportedCodes.includes(finding.code)) {
      throw new BadRequestException(
        `Repair action ${action} does not support finding ${finding.code}`,
      );
    }
  }

  private completed(
    findingId: string,
    action: ProjectDriftRepairAction,
    message: string,
    result?: Record<string, unknown>,
  ): ProjectDriftRepairResponse {
    return {
      enabled: true,
      mode: 'local_safe',
      findingId,
      action,
      status: 'completed',
      message,
      ...(result ? { result } : {}),
    };
  }

  private disabled(
    findingId: string,
    action: ProjectDriftRepairAction,
    message: string,
  ): ProjectDriftRepairResponse {
    return {
      enabled: false,
      mode: 'local_safe',
      findingId,
      action,
      status: 'disabled',
      message,
    };
  }
}
