import { Injectable, Logger } from '@nestjs/common';

import type { DeploymentProvisioningRequestDto } from '../projects/dto/create-project.dto';
import type { DeploymentProvisioningResult } from '../projects/projects.service';
import { DeploymentTargetsService } from './deployment-targets.service';
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import { EnvVarsService } from './env-vars.service';

interface ProvisionForProjectInput {
  projectId: string;
  userId: string;
  repoFullName: string;
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
          action: 'create',
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
          ...(requestedTarget.rootDirectory
            ? { rootDirectory: requestedTarget.rootDirectory }
            : {}),
          ...(requestedTarget.buildCommand
            ? { buildCommand: requestedTarget.buildCommand }
            : {}),
          ...(requestedTarget.startCommand
            ? { startCommand: requestedTarget.startCommand }
            : {}),
        };

        const target =
          await this.deploymentTargetsService.createDeploymentTarget(
            input.projectId,
            input.userId,
            targetRequest,
          );

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
          status: 'created',
          deploymentTargetId: target.id,
          providerProjectId: target.providerProjectId,
          providerProjectName: target.providerProjectName,
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
          status: 'failed',
          deploymentTargetId: null,
          providerProjectId: null,
          providerProjectName: null,
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

  private sanitizeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
  }
}
