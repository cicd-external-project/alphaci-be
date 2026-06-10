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

@Injectable()
export class DeploymentTargetsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly deploymentTargetsRepository: DeploymentTargetsRepository,
    private readonly providerConnectionsRepository: ProviderConnectionsRepository,
    private readonly encryptionService: EnvTokenEncryptionService,
    private readonly clientRegistry: ProviderClientRegistry,
    private readonly configService: ConfigService,
    private readonly deploymentStrategyResolver: DeploymentStrategyResolver,
  ) {}

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
    });
    const vercelScope = this.resolveVercelScope(
      dto.provider,
      dto.ownershipMode,
      providerAuth.connectionMetadata,
    );

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

      return {
        ...(teamId ? { vercelOrgId: teamId } : {}),
        ...(teamId ? { vercelTeamId: teamId } : {}),
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

    return {
      ...(orgId ? { vercelOrgId: orgId } : {}),
      ...(teamId ? { vercelTeamId: teamId } : {}),
      ...(teamSlug ? { vercelTeamSlug: teamSlug } : {}),
    };
  }

  private requireString(value: string | undefined, field: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }
}
