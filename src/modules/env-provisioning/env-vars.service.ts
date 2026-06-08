import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { DeploymentTargetsRepository } from './deployment-targets.repository';
import type { ProvisionEnvVarsDto } from './dto/provision-env-vars.dto';
import { EnvTokenEncryptionService } from './encryption.service';
import { EnvVarsRepository } from './env-vars.repository';
import type {
  DeploymentTargetSummary,
  EnvEnvironment,
  EnvProvider,
  EnvVarInput,
} from './env-provisioning.types';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { ProviderConnectionsRepository } from './provider-connections.repository';

const ENVIRONMENTS: EnvEnvironment[] = ['test', 'uat', 'production'];
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]{1,127}$/;
const MAX_ENV_VALUE_LENGTH = 16_384;

@Injectable()
export class EnvVarsService {
  constructor(
    private readonly envVarsRepository: EnvVarsRepository,
    private readonly deploymentTargetsRepository: DeploymentTargetsRepository,
    private readonly providerConnectionsRepository: ProviderConnectionsRepository,
    private readonly clientRegistry: ProviderClientRegistry,
    private readonly encryptionService: EnvTokenEncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async listEnvMetadata(projectId: string) {
    return this.envVarsRepository.listEnvMetadata(projectId);
  }

  async provisionEnvVars(
    projectId: string,
    userId: string,
    dto: ProvisionEnvVarsDto,
  ) {
    if (dto.deploymentTargetId === undefined) {
      throw new BadRequestException('deploymentTargetId is required');
    }
    if (!ENVIRONMENTS.includes(dto.environment)) {
      throw new BadRequestException('Invalid environment');
    }
    this.validateVars(dto.vars);

    const target =
      await this.deploymentTargetsRepository.findDeploymentTargetForUser(
        dto.deploymentTargetId,
        userId,
      );
    if (!target || target.projectId !== projectId) {
      throw new NotFoundException('Deployment target not found');
    }

    const token = await this.resolveProviderToken(target, userId);
    const result = await this.clientRegistry
      .getClient(target.provider)
      .upsertEnvironmentVariables({
        token,
        targetId: target.providerProjectId,
        environment: dto.environment,
        vars: dto.vars,
      });

    await this.envVarsRepository.upsertEnvMetadataBatch({
      projectId,
      deploymentTargetId: target.id,
      environment: dto.environment,
      provider: target.provider,
      provisionedBy: userId,
      entries: [
        ...result.provisioned.map((entry) => ({
          key: entry.key,
          status: entry.status,
          errorSummary: null,
        })),
        ...result.failed.map((entry) => ({
          key: entry.key,
          status: entry.status,
          errorSummary: this.sanitizeError(entry.errorSummary),
        })),
      ],
    });

    return result;
  }

  private validateVars(vars: EnvVarInput[] | undefined): void {
    if (!Array.isArray(vars) || vars.length === 0) {
      throw new BadRequestException('At least one env var is required');
    }

    const seen = new Set<string>();
    for (const variable of vars) {
      if (!ENV_KEY_PATTERN.test(variable.key)) {
        throw new BadRequestException(`Invalid env var key: ${variable.key}`);
      }
      if (seen.has(variable.key)) {
        throw new BadRequestException(`Duplicate env var key: ${variable.key}`);
      }
      if (
        typeof variable.value !== 'string' ||
        variable.value.length > MAX_ENV_VALUE_LENGTH
      ) {
        throw new BadRequestException(
          `Invalid env var value for key: ${variable.key}`,
        );
      }
      seen.add(variable.key);
    }
  }

  private async resolveProviderToken(
    target: DeploymentTargetSummary,
    userId: string,
  ): Promise<string> {
    if (target.ownershipMode === 'flowci_managed') {
      const config = this.configService.getOrThrow<AppConfig>('app');
      const token = this.getManagedToken(
        target.provider,
        config.envProvisioning.flowciManaged,
      );
      if (!token) {
        throw new BadRequestException(
          `FlowCI-managed ${target.provider} token is not configured`,
        );
      }

      return token;
    }

    if (!target.providerConnectionId) {
      throw new BadRequestException('Deployment target has no provider token');
    }
    const connection =
      await this.providerConnectionsRepository.findActiveProviderConnection(
        target.providerConnectionId,
        userId,
      );
    if (!connection || connection.provider !== target.provider) {
      throw new NotFoundException('Provider connection not found');
    }

    return this.encryptionService.decrypt(connection.encryptedToken);
  }

  private getManagedToken(
    provider: EnvProvider,
    config: AppConfig['envProvisioning']['flowciManaged'],
  ): string {
    return provider === 'render' ? config.renderToken : config.vercelToken;
  }

  private sanitizeError(error: string): string {
    return error.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
  }
}
