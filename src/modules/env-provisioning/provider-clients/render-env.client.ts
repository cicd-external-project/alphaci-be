import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../../config/app.config';
import type {
  CreateProviderTargetInput,
  ProviderAccountSummary,
  ProviderDeploymentTarget,
  ProviderProvisionResult,
  RuntimeEnvProviderClient,
  UpsertProviderEnvInput,
} from './runtime-env-provider.client';

const RENDER_API_URL = 'https://api.render.com/v1';

@Injectable()
export class RenderEnvClient implements RuntimeEnvProviderClient {
  readonly provider = 'render' as const;

  constructor(private readonly configService?: ConfigService) {}

  async validateConnection(token: string): Promise<ProviderAccountSummary> {
    const response = await fetch(`${RENDER_API_URL}/owners?limit=1`, {
      headers: this.headers(token),
    });
    await this.assertOk(response, 'Render connection validation failed');
    const owners = (await response.json()) as Array<{
      owner?: { id?: string; name?: string };
    }>;
    const owner = owners[0]?.owner;
    return {
      id: owner?.id ?? 'render-account',
      name: owner?.name ?? 'Render account',
      metadata: {
        ownerId: owner?.id ?? 'render-account',
        ownerName: owner?.name ?? 'Render account',
      },
    };
  }

  async listTargets(token: string): Promise<ProviderDeploymentTarget[]> {
    const response = await fetch(`${RENDER_API_URL}/services?limit=100`, {
      headers: this.headers(token),
    });
    await this.assertOk(response, 'Render services could not be loaded');
    const services = (await response.json()) as Array<{
      service?: { id?: string; name?: string };
    }>;

    return services
      .map((item) => item.service)
      .filter((service): service is { id: string; name: string } =>
        Boolean(service?.id && service?.name),
      )
      .map((service) => ({
        id: service.id,
        name: service.name,
        provider: this.provider,
      }));
  }

  async createTarget(
    input: CreateProviderTargetInput,
  ): Promise<ProviderDeploymentTarget> {
    const ownerId =
      this.getConfiguredOwnerId() ??
      (await this.getDefaultOwnerId(input.token));
    const response = await fetch(`${RENDER_API_URL}/services`, {
      method: 'POST',
      headers: this.headers(input.token),
      body: JSON.stringify(this.buildCreateServiceBody(input, ownerId)),
    });
    await this.assertOk(response, 'Render service could not be created');
    const payload = (await response.json()) as {
      id?: string;
      name?: string;
      service?: { id?: string; name?: string };
    };
    const serviceId = payload.service?.id ?? payload.id;
    const serviceName = payload.service?.name ?? payload.name;
    if (!serviceId || !serviceName) {
      throw new Error('Render service creation returned an invalid response');
    }
    const renderServiceType = input.renderServiceType ?? 'web_service';
    const renderEnvironmentName =
      input.renderEnvironmentName ??
      this.environmentFromBranch(input.branchName);
    const dockerContext =
      input.dockerContext ?? input.rootDirectory?.trim() ?? '.';
    const dockerfilePath = input.dockerfilePath ?? 'Dockerfile';

    return {
      id: serviceId,
      name: serviceName,
      provider: this.provider,
      metadata: {
        deploymentStrategy: input.deploymentStrategy ?? 'render_git_connected',
        renderServiceId: serviceId,
        renderOwnerId: ownerId,
        renderServiceType,
        renderInstanceType: input.renderInstanceType ?? null,
        renderRegion: input.renderRegion ?? null,
        renderEnvironmentName,
        renderRegistryCredentialId: this.getRegistryCredentialId(),
        dockerContext,
        dockerfilePath,
        imageUrl:
          input.deploymentStrategy === 'render_image_pushed'
            ? (input.imageUrl ?? this.getBootstrapImage())
            : null,
        bootstrapImage:
          input.deploymentStrategy === 'render_image_pushed'
            ? this.getBootstrapImage()
            : null,
      },
    };
  }

  async upsertEnvironmentVariables(
    input: UpsertProviderEnvInput,
  ): Promise<ProviderProvisionResult> {
    const currentResponse = await fetch(
      `${RENDER_API_URL}/services/${input.targetId}/env-vars`,
      { headers: this.headers(input.token) },
    );
    await this.assertOk(currentResponse, 'Render env vars could not be loaded');
    const current = (await currentResponse.json()) as Array<{
      envVar?: { key?: string; value?: string };
    }>;
    const merged = new Map<string, string>();
    for (const item of current) {
      if (item.envVar?.key) {
        merged.set(item.envVar.key, item.envVar.value ?? '');
      }
    }
    for (const variable of input.vars) {
      merged.set(variable.key, variable.value);
    }

    const response = await fetch(
      `${RENDER_API_URL}/services/${input.targetId}/env-vars`,
      {
        method: 'PUT',
        headers: this.headers(input.token),
        body: JSON.stringify(
          [...merged.entries()].map(([key, value]) => ({ key, value })),
        ),
      },
    );
    await this.assertOk(response, 'Render env vars could not be updated');

    return {
      provisioned: input.vars.map((variable) => ({
        key: variable.key,
        status: 'provisioned',
      })),
      failed: [],
    };
  }

  private async getDefaultOwnerId(token: string): Promise<string> {
    const response = await fetch(`${RENDER_API_URL}/owners?limit=1`, {
      headers: this.headers(token),
    });
    await this.assertOk(response, 'Render workspace could not be loaded');
    const owners = (await response.json()) as Array<{
      owner?: { id?: string };
    }>;
    const ownerId = owners[0]?.owner?.id;
    if (!ownerId) {
      throw new Error('Render workspace lookup returned no owner id');
    }

    return ownerId;
  }

  private buildCreateServiceBody(
    input: CreateProviderTargetInput,
    ownerId: string,
  ): Record<string, unknown> {
    const type = input.renderServiceType ?? 'web_service';
    const serviceDetails = this.serviceDetails(input);
    if (input.deploymentStrategy === 'render_image_pushed') {
      return {
        type,
        name: input.projectName,
        ownerId,
        autoDeploy: 'no',
        image: {
          ownerId,
          imagePath: input.imageUrl ?? this.getBootstrapImage(),
          ...(this.getRegistryCredentialId()
            ? { registryCredentialId: this.getRegistryCredentialId() }
            : {}),
        },
        serviceDetails,
      };
    }

    return {
      type,
      name: input.projectName,
      ownerId,
      repo: `https://github.com/${input.repoFullName}`,
      branch: input.branchName,
      rootDir: input.rootDirectory,
      buildCommand: input.buildCommand,
      startCommand: input.startCommand,
      serviceDetails,
    };
  }

  private serviceDetails(
    input: CreateProviderTargetInput,
  ): Record<string, unknown> {
    const runtime =
      input.deploymentStrategy === 'render_image_pushed' ? 'image' : 'node';

    return {
      runtime,
      ...(input.renderInstanceType ? { plan: input.renderInstanceType } : {}),
      ...(input.renderRegion ? { region: input.renderRegion } : {}),
      ...(input.startCommand &&
      input.deploymentStrategy !== 'render_image_pushed'
        ? { startCommand: input.startCommand }
        : {}),
      ...(input.buildCommand &&
      input.deploymentStrategy !== 'render_image_pushed'
        ? { buildCommand: input.buildCommand }
        : {}),
    };
  }

  private getBootstrapImage(): string {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return (
      config?.envProvisioning.flowciManaged.renderBootstrapImage ??
      'docker.io/library/nginx:alpine'
    );
  }

  private getRegistryCredentialId(): string | null {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    return (
      config?.envProvisioning.flowciManaged.renderRegistryCredentialId?.trim() ||
      null
    );
  }

  private environmentFromBranch(
    branchName: string | undefined,
  ): 'test' | 'uat' | 'production' {
    if (branchName === 'main') {
      return 'production';
    }
    if (branchName === 'uat' || branchName === 'production') {
      return branchName;
    }

    return 'test';
  }

  private getConfiguredOwnerId(): string | null {
    const ownerId = this.configService
      ?.getOrThrow<AppConfig>('app')
      .envProvisioning.flowciManaged.renderOwnerId?.trim();

    return ownerId || null;
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private async assertOk(response: Response, message: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 402) {
        throw new Error(
          'Render billing is not configured for this workspace or the selected instance type requires payment.',
        );
      }
      if (response.status === 409) {
        throw new Error(
          'A Render service with this name already exists in the selected workspace.',
        );
      }
      if (response.status === 401) {
        throw new Error(
          'Render API key is invalid or missing required workspace access.',
        );
      }

      const summary = body ? ` ${body.slice(0, 300)}` : '';
      throw new Error(`${message}: ${response.status}${summary}`);
    }
  }
}
