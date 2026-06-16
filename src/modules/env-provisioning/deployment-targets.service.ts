import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { AuditEventsService } from '../audit/audit-events.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { ProjectsRepository } from '../projects/projects.repository';
import {
  DeploymentTargetsRepository,
  type UpdateDeploymentTargetMetadataInput,
} from './deployment-targets.repository';
import { DeploymentStrategyResolver } from './deployment-strategy.resolver';
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import { EnvTokenEncryptionService } from './encryption.service';
import type {
  DeploymentTargetSummary,
  EnvProvider,
  EnvTargetSlot,
  RenderEnvironmentName,
} from './env-provisioning.types';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { ProviderConnectionsRepository } from './provider-connections.repository';
import { RenderCostPolicyService } from './render-cost-policy.service';
import { UsageQuotaService } from '../usage/usage-quota.service';
import type { UsageLimitCode } from '../usage/usage.types';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

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
    @Optional()
    private readonly usageQuotaService?: UsageQuotaService,
    @Optional()
    private readonly workspaceAccessService?: WorkspaceAccessService,
    @Optional()
    private readonly auditEventsService?: AuditEventsService,
    @Optional()
    private readonly notificationEventsService?: NotificationEventsService,
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
    await this.assertProjectMutationAccess(projectId, userId);
    const project = await this.getProjectOrThrow(projectId, userId);
    await this.assertWithinQuota(userId, projectId, 'deployment_targets');
    if (dto.ownershipMode === 'flowci_managed' && dto.provider === 'render') {
      await this.assertWithinQuota(
        userId,
        projectId,
        'managed_render_services',
      );
    }
    if (dto.ownershipMode === 'flowci_managed' && dto.provider === 'vercel') {
      await this.assertWithinQuota(
        userId,
        projectId,
        'managed_vercel_projects',
      );
    }
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
            ...(renderDefaults.renderRuntime
              ? { renderRuntime: renderDefaults.renderRuntime }
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

    const created =
      await this.deploymentTargetsRepository.createDeploymentTarget({
        projectId,
        slot: dto.slot,
        ownershipMode: dto.ownershipMode,
        provider: dto.provider,
        providerConnectionId:
          dto.ownershipMode === 'byo'
            ? (dto.providerConnectionId ?? null)
            : null,
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
        providerMetadata: {
          ...(target.metadata ?? {}),
          ...(renderDefaults.renderRuntime
            ? { renderRuntime: renderDefaults.renderRuntime }
            : {}),
        },
      });
    await this.recordTargetEvent({
      userId,
      projectId,
      eventCode: 'deployment_target_created',
      title: 'Deployment target created',
      body: `${created.providerProjectName} was attached to this project.`,
      metadata: {
        targetId: created.id,
        provider: created.provider,
        slot: created.slot,
      },
    });
    return created;
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

  async updateDeploymentTargetMetadata(
    projectId: string,
    targetId: string,
    userId: string,
    input: UpdateDeploymentTargetMetadataInput,
  ) {
    if (!this.projectTargetManagementEnabled()) {
      throw new BadRequestException('Project target management is disabled');
    }

    await this.assertProjectMutationAccess(projectId, userId);
    await this.getProjectOrThrow(projectId, userId);
    const target =
      await this.deploymentTargetsRepository.updateDeploymentTargetMetadataForUser(
        projectId,
        targetId,
        userId,
        this.normalizeMetadataUpdate(input),
      );
    if (!target) {
      throw new NotFoundException('Deployment target not found');
    }

    await this.recordTargetEvent({
      userId,
      projectId,
      eventCode: 'deployment_target_updated',
      title: 'Deployment target updated',
      body: `${target.providerProjectName} metadata was updated.`,
      metadata: {
        targetId: target.id,
        provider: target.provider,
        slot: target.slot,
      },
    });
    return target;
  }

  async syncDeploymentTarget(
    projectId: string,
    targetId: string,
    userId: string,
  ): Promise<{
    mode: 'local_metadata';
    status: DeploymentTargetSummary['status'];
    findings: Array<{ code: string; severity: 'warning'; message: string }>;
    target: DeploymentTargetSummary;
  }> {
    if (!this.projectTargetManagementEnabled()) {
      throw new BadRequestException('Project target management is disabled');
    }

    await this.assertProjectMutationAccess(projectId, userId);
    const target = await this.getOwnedTargetOrThrow(
      projectId,
      targetId,
      userId,
    );
    const findings: Array<{
      code: string;
      severity: 'warning';
      message: string;
    }> = [];

    if (!target.providerProjectId?.trim()) {
      findings.push({
        code: 'provider_project_id_missing',
        severity: 'warning',
        message: 'Provider project ID is not tracked for this target.',
      });
    }
    if (!target.branchName?.trim()) {
      findings.push({
        code: 'target_branch_missing',
        severity: 'warning',
        message: 'Branch metadata is not tracked for this target.',
      });
    }

    const response = {
      mode: 'local_metadata' as const,
      status: findings.length > 0 ? 'missing' : target.status,
      findings,
      target,
    };
    await this.recordTargetEvent({
      userId,
      projectId,
      eventCode: 'deployment_target_synced',
      title: 'Deployment target synced',
      body: `${target.providerProjectName} metadata was checked.`,
      metadata: {
        targetId: target.id,
        provider: target.provider,
        status: response.status,
        findingCount: findings.length,
      },
    });
    return response;
  }

  async detachDeploymentTarget(
    projectId: string,
    targetId: string,
    userId: string,
  ): Promise<{ detached: true }> {
    if (!this.projectTargetManagementEnabled()) {
      throw new BadRequestException('Project target management is disabled');
    }

    await this.assertProjectMutationAccess(projectId, userId);
    await this.getProjectOrThrow(projectId, userId);
    const deleted =
      await this.deploymentTargetsRepository.deleteDeploymentTargetForUser(
        projectId,
        targetId,
        userId,
      );
    if (!deleted) {
      throw new NotFoundException('Deployment target not found');
    }

    await this.recordTargetEvent({
      userId,
      projectId,
      eventCode: 'deployment_target_detached',
      title: 'Deployment target detached',
      body: 'Deployment target metadata was removed from FlowCI.',
      metadata: { targetId },
    });
    return { detached: true };
  }

  async getDeploymentTargetActions(
    projectId: string,
    targetId: string,
    userId: string,
  ) {
    if (!this.projectTargetManagementEnabled()) {
      throw new BadRequestException('Project target management is disabled');
    }

    const target = await this.getOwnedTargetOrThrow(
      projectId,
      targetId,
      userId,
    );

    return {
      targetId: target.id,
      provider: target.provider,
      actions: {
        sync: {
          enabled: true,
          mode: 'local_metadata' as const,
        },
        detach: {
          enabled: true,
        },
        reinstallDeploymentSecrets: {
          enabled: false,
          reason: 'Provider activation required',
        },
        openProviderDashboard: {
          enabled: this.providerDashboardUrl(target) !== null,
          url: this.providerDashboardUrl(target),
        },
      },
    };
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

  private async assertProjectMutationAccess(
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.workspaceAccessService?.assertProjectRole(projectId, userId, [
      'owner',
      'admin',
      'developer',
    ]);
  }

  private async assertWithinQuota(
    userId: string,
    projectId: string,
    limitCode: UsageLimitCode,
  ): Promise<void> {
    try {
      await this.usageQuotaService?.assertWithinLimit(userId, limitCode);
    } catch (error) {
      await this.recordTargetEvent({
        userId,
        projectId,
        eventCode: 'quota_blocked',
        title: 'Quota blocked action',
        body: `Quota ${limitCode} blocked this action.`,
        metadata: { limitCode },
      });
      throw error;
    }
  }

  private async recordTargetEvent(input: {
    userId: string;
    projectId: string;
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

  private async getOwnedTargetOrThrow(
    projectId: string,
    targetId: string,
    userId: string,
  ): Promise<DeploymentTargetSummary> {
    await this.getProjectOrThrow(projectId, userId);
    const target =
      await this.deploymentTargetsRepository.findDeploymentTargetForUser(
        targetId,
        userId,
      );
    if (!target || target.projectId !== projectId) {
      throw new NotFoundException('Deployment target not found');
    }

    return target;
  }

  private projectTargetManagementEnabled(): boolean {
    const config = this.configService.getOrThrow<AppConfig>('app');
    return config.projectTargetManagement?.enabled ?? false;
  }

  private normalizeMetadataUpdate(
    input: UpdateDeploymentTargetMetadataInput,
  ): UpdateDeploymentTargetMetadataInput {
    const normalized: UpdateDeploymentTargetMetadataInput = {};
    if (input.slot !== undefined) {
      normalized.slot = this.requireTargetSlot(input.slot);
    }
    if (input.providerProjectName !== undefined) {
      normalized.providerProjectName = this.requireString(
        input.providerProjectName,
        'providerProjectName',
      );
    }
    if (input.branchName !== undefined) {
      normalized.branchName = this.requireString(
        input.branchName,
        'branchName',
      );
    }
    if (input.rootDirectory !== undefined) {
      normalized.rootDirectory = input.rootDirectory?.trim() || null;
    }
    if (input.buildCommand !== undefined) {
      normalized.buildCommand = input.buildCommand?.trim() || null;
    }
    if (input.startCommand !== undefined) {
      normalized.startCommand = input.startCommand?.trim() || null;
    }
    if (input.renderEnvironmentName !== undefined) {
      normalized.renderEnvironmentName =
        input.renderEnvironmentName === null
          ? null
          : this.requireRenderEnvironment(input.renderEnvironmentName);
    }

    return normalized;
  }

  private requireTargetSlot(value: unknown): EnvTargetSlot {
    if (value === 'backend' || value === 'frontend' || value === 'standalone') {
      return value;
    }

    throw new BadRequestException(
      'slot must be backend, frontend, or standalone',
    );
  }

  private requireRenderEnvironment(value: unknown): RenderEnvironmentName {
    if (value === 'test' || value === 'uat' || value === 'production') {
      return value;
    }

    throw new BadRequestException(
      'renderEnvironmentName must be test, uat, or production',
    );
  }

  private providerDashboardUrl(target: DeploymentTargetSummary): string | null {
    if (target.provider === 'vercel') {
      const teamSlug =
        typeof target.providerMetadata['vercelTeamSlug'] === 'string'
          ? target.providerMetadata['vercelTeamSlug'].trim()
          : '';
      return teamSlug
        ? `https://vercel.com/${teamSlug}/${target.providerProjectName}`
        : `https://vercel.com/dashboard/project/${target.providerProjectId}`;
    }

    if (target.provider === 'render') {
      return `https://dashboard.render.com/web/${target.providerProjectId}`;
    }

    return null;
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
    renderRuntime: CreateDeploymentTargetDto['renderRuntime'] | null;
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
        renderRuntime: null,
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
      renderRuntime: dto.renderRuntime ?? 'node',
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
      renderRuntime: renderDefaults.renderRuntime,
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
