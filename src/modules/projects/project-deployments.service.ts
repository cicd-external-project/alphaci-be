import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { DeploymentTargetsRepository } from '../env-provisioning/deployment-targets.repository';
import { LocalDeploymentHistoryProvider } from './local-deployment-history.provider';
import type { ProjectDeploymentHistoryItem } from './project-deployments.types';
import { ProjectsRepository } from './projects.repository';

export interface ProjectDeploymentsResponse {
  enabled: boolean;
  mode: 'local_mock';
  liveProvidersEnabled: boolean;
  deployments: ProjectDeploymentHistoryItem[];
}

@Injectable()
export class ProjectDeploymentsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly deploymentTargetsRepository: DeploymentTargetsRepository,
    private readonly provider: LocalDeploymentHistoryProvider = new LocalDeploymentHistoryProvider(),
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async listDeployments(
    projectId: string,
    userId: string,
  ): Promise<ProjectDeploymentsResponse> {
    const project = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!this.enabled()) {
      return {
        enabled: false,
        mode: 'local_mock',
        liveProvidersEnabled: this.liveProvidersEnabled(),
        deployments: [],
      };
    }

    const targets =
      await this.deploymentTargetsRepository.listDeploymentTargets(projectId);

    return {
      enabled: true,
      mode: 'local_mock',
      liveProvidersEnabled: this.liveProvidersEnabled(),
      deployments: await this.provider.listDeployments(targets),
    };
  }

  private enabled(): boolean {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return config?.deploymentHistory?.enabled ?? false;
  }

  private liveProvidersEnabled(): boolean {
    return false;
  }
}
