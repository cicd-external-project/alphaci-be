import { Injectable, Logger } from '@nestjs/common';

import type { DeploymentProvisioningRequestDto } from '../projects/dto/create-project.dto';
import type { DeploymentProvisioningResult } from '../projects/projects.service';
import { DeploymentTargetsService } from './deployment-targets.service';
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import { EnvVarsService } from './env-vars.service';
import { RenderCiSecretsService } from './render-ci-secrets.service';
import { VercelCiSecretsService } from './vercel-ci-secrets.service';

interface ProvisionForProjectInput {
  projectId: string;
  userId: string;
  repoFullName: string;
  githubAccessToken?: string;
  request: DeploymentProvisioningRequestDto | undefined;
}

@Injectable()
export class ProjectDeploymentProvisioningService {
  private readonly logger = new Logger(
    ProjectDeploymentProvisioningService.name,
  );

  constructor(
    private readonly deploymentTargetsService: DeploymentTargetsService,
    private readonly envVarsService: EnvVarsService,
    private readonly vercelCiSecretsService: VercelCiSecretsService,
    private readonly renderCiSecretsService?: RenderCiSecretsService,
  ) {}

  async provisionForProject(
    input: ProvisionForProjectInput,
  ): Promise<DeploymentProvisioningResult> {
    if (!input.request?.enabled || input.request.targets.length === 0) {
      return { status: 'skipped', targets: [] };
    }

    const targets: DeploymentProvisioningResult['targets'] = [];

    for (const requestedTarget of input.request.targets) {
      try {
        const targetRequest: CreateDeploymentTargetDto = {
          action:
            requestedTarget.action ??
            (requestedTarget.renderDeployMethod === 'existing_service'
              ? 'register_existing'
              : 'create'),
          slot: requestedTarget.slot,
          ownershipMode: requestedTarget.ownershipMode,
          provider: requestedTarget.provider,
          branchName: requestedTarget.branchName ?? 'test',
          ...(requestedTarget.providerConnectionId
            ? { providerConnectionId: requestedTarget.providerConnectionId }
            : {}),
          ...(requestedTarget.projectName
            ? { projectName: requestedTarget.projectName }
            : {}),
          ...(requestedTarget.providerProjectId
            ? { providerProjectId: requestedTarget.providerProjectId }
            : {}),
          ...(requestedTarget.providerProjectName
            ? { providerProjectName: requestedTarget.providerProjectName }
            : {}),
          ...(requestedTarget.rootDirectory
            ? { rootDirectory: requestedTarget.rootDirectory }
            : {}),
          ...(requestedTarget.buildCommand
            ? { buildCommand: requestedTarget.buildCommand }
            : {}),
          ...(requestedTarget.startCommand
            ? { startCommand: requestedTarget.startCommand }
            : {}),
          ...(requestedTarget.renderDeployMethod
            ? { renderDeployMethod: requestedTarget.renderDeployMethod }
            : {}),
          ...(requestedTarget.renderServiceType
            ? { renderServiceType: requestedTarget.renderServiceType }
            : {}),
          ...(requestedTarget.renderRuntime
            ? { renderRuntime: requestedTarget.renderRuntime }
            : {}),
          ...(requestedTarget.renderInstanceType
            ? { renderInstanceType: requestedTarget.renderInstanceType }
            : {}),
          ...(requestedTarget.renderRegion
            ? { renderRegion: requestedTarget.renderRegion }
            : {}),
          ...(requestedTarget.renderEnvironmentName
            ? { renderEnvironmentName: requestedTarget.renderEnvironmentName }
            : {}),
          ...(requestedTarget.dockerContext
            ? { dockerContext: requestedTarget.dockerContext }
            : {}),
          ...(requestedTarget.dockerfilePath
            ? { dockerfilePath: requestedTarget.dockerfilePath }
            : {}),
          ...(requestedTarget.imageUrl
            ? { imageUrl: requestedTarget.imageUrl }
            : {}),
        };

        const target =
          await this.deploymentTargetsService.createDeploymentTarget(
            input.projectId,
            input.userId,
            targetRequest,
          );
        let providerMetadata = target.providerMetadata;

        if (target.deploymentStrategy === 'vercel_ci_pushed') {
          if (!input.githubAccessToken) {
            throw new Error(
              'GitHub access token is required to install Vercel deployment secrets',
            );
          }

          const secretResult =
            await this.vercelCiSecretsService.installForTarget({
              githubAccessToken: input.githubAccessToken,
              repoFullName: input.repoFullName,
              userId: input.userId,
              providerConnectionId:
                requestedTarget.providerConnectionId ?? null,
              target,
            });
          providerMetadata = {
            ...target.providerMetadata,
            githubSecrets: secretResult.githubSecrets,
          };
          await this.deploymentTargetsService.updateProviderMetadata(
            target.id,
            providerMetadata,
          );
        }

        if (
          target.provider === 'render' &&
          ['render_image_pushed', 'render_existing_service'].includes(
            target.deploymentStrategy,
          )
        ) {
          if (!input.githubAccessToken) {
            throw new Error(
              'GitHub access token is required to install Render deployment secrets',
            );
          }
          if (!this.renderCiSecretsService) {
            throw new Error(
              'Render deployment secret installer is not configured',
            );
          }

          const secretResult =
            await this.renderCiSecretsService.installForTarget({
              githubAccessToken: input.githubAccessToken,
              repoFullName: input.repoFullName,
              userId: input.userId,
              providerConnectionId:
                requestedTarget.providerConnectionId ?? null,
              target,
            });
          providerMetadata = {
            ...providerMetadata,
            githubSecrets: secretResult.githubSecrets,
          };
          await this.deploymentTargetsService.updateProviderMetadata(
            target.id,
            providerMetadata,
          );
        }

        const env: DeploymentProvisioningResult['targets'][number]['env'] = [];
        for (const envSet of requestedTarget.env ?? []) {
          const result = await this.envVarsService.provisionEnvVars(
            input.projectId,
            input.userId,
            {
              deploymentTargetId: target.id,
              environment: envSet.environment,
              vars: envSet.vars,
            },
          );

          env.push({
            environment: envSet.environment,
            provisioned: result.provisioned,
            failed: result.failed,
          });
        }

        targets.push({
          slot: requestedTarget.slot,
          provider: requestedTarget.provider,
          ownershipMode: requestedTarget.ownershipMode,
          deploymentStrategy: target.deploymentStrategy,
          status: 'created',
          deploymentTargetId: target.id,
          providerProjectId: target.providerProjectId,
          providerProjectName: target.providerProjectName,
          providerMetadata,
          ...this.renderResultMetadata(target),
          errorSummary: null,
          env,
        });
      } catch (error) {
        this.logger.warn(
          `Deployment provisioning failed for ${input.repoFullName}/${requestedTarget.slot}: ${String(error)}`,
        );
        targets.push({
          slot: requestedTarget.slot,
          provider: requestedTarget.provider,
          ownershipMode: requestedTarget.ownershipMode,
          deploymentStrategy: null,
          status: 'failed',
          deploymentTargetId: null,
          providerProjectId: null,
          providerProjectName: null,
          providerMetadata: {},
          errorSummary: this.sanitizeError(error),
          env: [],
        });
      }
    }

    return {
      status: this.aggregateStatus(targets),
      targets,
    };
  }

  private aggregateStatus(
    targets: DeploymentProvisioningResult['targets'],
  ): DeploymentProvisioningResult['status'] {
    if (targets.length === 0) {
      return 'skipped';
    }

    const failedCount = targets.filter(
      (target) => target.status === 'failed',
    ).length;
    if (failedCount === 0) {
      return 'completed';
    }

    return failedCount === targets.length ? 'failed' : 'partial';
  }

  private renderResultMetadata(target: {
    renderServiceType?: unknown;
    renderRuntime?: unknown;
    renderInstanceType?: unknown;
    renderRegion?: unknown;
    renderEnvironmentName?: unknown;
    dockerContext?: unknown;
    dockerfilePath?: unknown;
    imageUrl?: unknown;
  }): Record<string, string | null> {
    const metadata: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(target)) {
      if (typeof value === 'string' || value === null) {
        metadata[key] = value;
      }
    }

    return metadata;
  }

  private sanitizeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
  }
}
