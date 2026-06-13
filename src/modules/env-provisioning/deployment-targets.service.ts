import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { ProjectsRepository } from '../projects/projects.repository';
import { DeploymentTargetsRepository } from './deployment-targets.repository';
import { DeploymentStrategyResolver } from './deployment-strategy.resolver';
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import { EnvTokenEncryptionService } from './encryption.service';
import type { EnvProvider } from './env-provisioning.types';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { ProviderConnectionsRepository } from './provider-connections.repository';
import { RenderCostPolicyService } from './render-cost-policy.service';

@Injectable()
export class DeploymentTargetsService {
  private readonly renderCostPolicy: RenderCostPolicyService;

  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly deploymentTargetsRepository: DeploymentTargetsRepository,
    private readonly providerConnectionsRepository: ProviderConnectionsRepository,
    private readonly encryptionService: EnvTokenEncryptionService,
    private readonly clientRegistry: ProviderClientRegistry,
    private readonly configService: ConfigService,
    private readonly deploymentStrategyResolver: DeploymentStrategyResolver,
    renderCostPolicyService?: RenderCostPolicyService,
  ) {
    this.renderCostPolicy =
      renderCostPolicyService ?? new RenderCostPolicyService(configService);
  }

  async listDeploymentTargets(projectId: string, userId: string) {
    await this.getProjectOrThrow(projectId, userId);
    return this.deploymentTargetsRepository.listDeploymentTargets(projectId);
  }

  async createDeploymentTarget(
    projectId: string,
    userId: string,
    dto: CreateDeploymentTargetDto,
  ) {
    const project = await this.getProjectOrThrow(projectId, userId);
    const tokenInput: {
      ownershipMode: string;
      providerConnectionId?: string;
    } = { ownershipMode: dto.ownershipMode };
    if (dto.providerConnectionId) {
      tokenInput.providerConnectionId = dto.providerConnectionId;
    }
    const providerAuth = await this.resolveProviderToken(
      dto.provider,
      userId,
      tokenInput,
    );
    const deploymentStrategy = this.deploymentStrategyResolver.resolve({
      provider: dto.provider,
      ownershipMode: dto.ownershipMode,
      action: dto.action,
      renderDeployMethod: dto.renderDeployMethod,
    });
    const vercelScope = this.resolveVercelScope(
      dto.provider,
      dto.ownershipMode,
      providerAuth.connectionMetadata,
    );
    const renderDefaults = this.resolveRenderDefaults(dto);

    const target =
      dto.action === 'create'
        ? await this.clientRegistry.getClient(dto.provider).createTarget({
            token: providerAuth.token,
            repoFullName: project.repo_full_name,
            projectName: this.requireString(dto.projectName, 'projectName'),
            branchName: dto.branchName?.trim() || 'test',
            ...(dto.rootDirectory?.trim()
              ? { rootDirectory: dto.rootDirectory.trim() }
              : {}),
            ...(dto.buildCommand?.trim()
              ? { buildCommand: dto.buildCommand.trim() }
              : {}),
            ...(dto.startCommand?.trim()
              ? { startCommand: dto.startCommand.trim() }
              : {}),
            deploymentStrategy,
            ...(renderDefaults.renderServiceType
              ? { renderServiceType: renderDefaults.renderServiceType }
              : {}),
            ...(renderDefaults.renderInstanceType
              ? { renderInstanceType: renderDefaults.renderInstanceType }
              : {}),
            ...(renderDefaults.renderRegion
              ? { renderRegion: renderDefaults.renderRegion }
              : {}),
            ...(renderDefaults.renderEnvironmentName
              ? { renderEnvironmentName: renderDefaults.renderEnvironmentName }
              : {}),
            ...(renderDefaults.dockerContext
              ? { dockerContext: renderDefaults.dockerContext }
              : {}),
            ...(renderDefaults.dockerfilePath
              ? { dockerfilePath: renderDefaults.dockerfilePath }
              : {}),
            ...(dto.imageUrl?.trim() ? { imageUrl: dto.imageUrl.trim() } : {}),
            ...(vercelScope.vercelTeamId
              ? { vercelTeamId: vercelScope.vercelTeamId }
              : {}),
            ...(vercelScope.vercelOrgId
              ? { vercelOrgId: vercelScope.vercelOrgId }
              : {}),
            ...(vercelScope.vercelTeamSlug
              ? { vercelTeamSlug: vercelScope.vercelTeamSlug }
              : {}),
          })
        : {
            id: this.requireString(dto.providerProjectId, 'providerProjectId'),
            name: this.requireString(
              dto.providerProjectName,
              'providerProjectName',
            ),
            provider: dto.provider,
            metadata: this.registerExistingMetadata(dto, renderDefaults),
          };

    return this.deploymentTargetsRepository.createDeploymentTarget({
      projectId,
      slot: dto.slot,
      ownershipMode: dto.ownershipMode,
      provider: dto.provider,
      providerConnectionId:
        dto.ownershipMode === 'byo' ? (dto.providerConnectionId ?? null) : null,
      providerProjectId: target.id,
      providerProjectName: target.name,
      repoFullName: project.repo_full_name,
      branchName: dto.branchName?.trim() || 'test',
      rootDirectory: dto.rootDirectory?.trim() || null,
      buildCommand: dto.buildCommand?.trim() || null,
      startCommand: dto.startCommand?.trim() || null,
      renderServiceType: renderDefaults.renderServiceType,
      renderInstanceType: renderDefaults.renderInstanceType,
      renderRegion: renderDefaults.renderRegion,
      renderEnvironmentName: renderDefaults.renderEnvironmentName,
      dockerContext: renderDefaults.dockerContext,
      dockerfilePath: renderDefaults.dockerfilePath,
      imageUrl: dto.imageUrl?.trim() || null,
      environmentMap: dto.environmentMap ?? {},
      deploymentStrategy,
      providerMetadata: target.metadata ?? {},
    });
  }

  updateProviderMetadata(
    targetId: string,
    providerMetadata: Record<string, unknown>,
    status?: 'active' | 'missing' | 'failed',
  ) {
    return this.deploymentTargetsRepository.updateProviderMetadata(
      targetId,
      providerMetadata,
      status,
    );
  }

  private async getProjectOrThrow(projectId: string, userId: string) {
    const project = await this.projectsRepository.findByIdAndUser(
      projectId,
      userId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private async resolveProviderToken(
    provider: EnvProvider,
    userId: string,
    input: {
      ownershipMode: string;
      providerConnectionId?: string;
    },
  ): Promise<{ token: string; connectionMetadata: Record<string, unknown> }> {
    if (input.ownershipMode === 'flowci_managed') {
      const config = this.configService.getOrThrow<AppConfig>('app');
      const token =
        provider === 'render'
          ? config.envProvisioning.flowciManaged.renderToken
          : config.envProvisioning.flowciManaged.vercelToken;
      if (!token) {
        throw new BadRequestException(
          `FlowCI-managed ${provider} token is not configured`,
        );
      }

      return { token, connectionMetadata: {} };
    }

    if (!input.providerConnectionId) {
      throw new BadRequestException('providerConnectionId is required');
    }
    const connection =
      await this.providerConnectionsRepository.findActiveProviderConnection(
        input.providerConnectionId,
        userId,
      );
    if (!connection || connection.provider !== provider) {
      throw new NotFoundException('Provider connection not found');
    }

    return {
      token: this.encryptionService.decrypt(connection.encryptedToken),
      connectionMetadata: connection.metadata,
    };
  }

  private resolveVercelScope(
    provider: EnvProvider,
    ownershipMode: string,
    connectionMetadata: Record<string, unknown>,
  ): {
    vercelOrgId?: string;
    vercelTeamId?: string;
    vercelTeamSlug?: string;
  } {
    if (provider !== 'vercel') {
      return {};
    }

    if (ownershipMode === 'flowci_managed') {
      const config = this.configService.getOrThrow<AppConfig>('app');
      const teamId =
        config.envProvisioning.flowciManaged.vercelTeamId?.trim() ?? '';
      const teamSlug =
        config.envProvisioning.flowciManaged.vercelTeamSlug?.trim() ?? '';
      if (!teamId) {
        throw new BadRequestException(
          'FLOWCI_VERCEL_TEAM_ID is required for FlowCI-managed Vercel deployment targets',
        );
      }

      return {
        vercelOrgId: teamId,
        vercelTeamId: teamId,
        ...(teamSlug ? { vercelTeamSlug: teamSlug } : {}),
      };
    }

    const teamId =
      typeof connectionMetadata['teamId'] === 'string'
        ? connectionMetadata['teamId'].trim()
        : '';
    const teamSlug =
      typeof connectionMetadata['teamSlug'] === 'string'
        ? connectionMetadata['teamSlug'].trim()
        : '';
    const orgId =
      typeof connectionMetadata['orgId'] === 'string'
        ? connectionMetadata['orgId'].trim()
        : '';

    if (!orgId && !teamId) {
      throw new BadRequestException(
        'Vercel provider connection is missing org metadata. Reconnect the Vercel account before provisioning deployment targets.',
      );
    }

    return {
      vercelOrgId: orgId || teamId,
      ...(teamId ? { vercelTeamId: teamId } : {}),
      ...(teamSlug ? { vercelTeamSlug: teamSlug } : {}),
    };
  }

  private resolveRenderDefaults(dto: CreateDeploymentTargetDto): {
    renderServiceType: CreateDeploymentTargetDto['renderServiceType'] | null;
    renderInstanceType: string | null;
    renderRegion: string | null;
    renderEnvironmentName:
      | CreateDeploymentTargetDto['renderEnvironmentName']
      | null;
    dockerContext: string | null;
    dockerfilePath: string | null;
  } {
    if (dto.provider !== 'render') {
      return {
        renderServiceType: null,
        renderInstanceType: null,
        renderRegion: null,
        renderEnvironmentName: null,
        dockerContext: null,
        dockerfilePath: null,
      };
    }

    const defaults = this.renderCostPolicy.resolveDefaults({
      ownershipMode: dto.ownershipMode,
      serviceType: dto.renderServiceType,
      instanceType: dto.renderInstanceType,
      region: dto.renderRegion,
    });
    const rootDirectory = dto.rootDirectory?.trim() || '.';
    const dockerContext =
      dto.dockerContext?.trim() ||
      (rootDirectory === '.' ? '.' : rootDirectory);

    return {
      renderServiceType: defaults.serviceType,
      renderInstanceType: defaults.instanceType,
      renderRegion: defaults.region,
      renderEnvironmentName:
        dto.renderEnvironmentName ?? this.environmentFromBranch(dto.branchName),
      dockerContext,
      dockerfilePath: dto.dockerfilePath?.trim() || 'Dockerfile',
    };
  }

  private environmentFromBranch(
    branchName: string | undefined,
  ): CreateDeploymentTargetDto['renderEnvironmentName'] {
    const branch = branchName?.trim();
    if (branch === 'main') {
      return 'production';
    }
    if (branch === 'uat' || branch === 'production') {
      return branch;
    }

    return 'test';
  }

  private registerExistingMetadata(
    dto: CreateDeploymentTargetDto,
    renderDefaults: ReturnType<
      DeploymentTargetsService['resolveRenderDefaults']
    >,
  ): Record<string, unknown> {
    if (dto.provider !== 'render') {
      return {};
    }

    return {
      deploymentStrategy: 'render_existing_service',
      renderServiceType: renderDefaults.renderServiceType,
      renderInstanceType: renderDefaults.renderInstanceType,
      renderRegion: renderDefaults.renderRegion,
      renderEnvironmentName: renderDefaults.renderEnvironmentName,
      dockerContext: renderDefaults.dockerContext,
      dockerfilePath: renderDefaults.dockerfilePath,
    };
  }

  private requireString(value: string | undefined, field: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }
}
