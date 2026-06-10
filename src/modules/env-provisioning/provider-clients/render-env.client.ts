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
    this.assertOk(response, 'Render connection validation failed');
    const owners = (await response.json()) as Array<{
      owner?: { id?: string; name?: string };
    }>;
    const owner = owners[0]?.owner;
    return {
      id: owner?.id ?? 'render-account',
      name: owner?.name ?? 'Render account',
    };
  }

  async listTargets(token: string): Promise<ProviderDeploymentTarget[]> {
    const response = await fetch(`${RENDER_API_URL}/services?limit=100`, {
      headers: this.headers(token),
    });
    this.assertOk(response, 'Render services could not be loaded');
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
      body: JSON.stringify({
        type: 'web_service',
        name: input.projectName,
        ownerId,
        repo: `https://github.com/${input.repoFullName}`,
        branch: input.branchName,
        rootDir: input.rootDirectory,
        buildCommand: input.buildCommand,
        startCommand: input.startCommand,
      }),
    });
    this.assertOk(response, 'Render service could not be created');
    const payload = (await response.json()) as {
      service?: { id?: string; name?: string };
    };
    const service = payload.service;
    if (!service?.id || !service.name) {
      throw new Error('Render service creation returned an invalid response');
    }

    return {
      id: service.id,
      name: service.name,
      provider: this.provider,
    };
  }

  async upsertEnvironmentVariables(
    input: UpsertProviderEnvInput,
  ): Promise<ProviderProvisionResult> {
    const currentResponse = await fetch(
      `${RENDER_API_URL}/services/${input.targetId}/env-vars`,
      { headers: this.headers(input.token) },
    );
    this.assertOk(currentResponse, 'Render env vars could not be loaded');
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
    this.assertOk(response, 'Render env vars could not be updated');

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
    this.assertOk(response, 'Render workspace could not be loaded');
    const owners = (await response.json()) as Array<{
      owner?: { id?: string };
    }>;
    const ownerId = owners[0]?.owner?.id;
    if (!ownerId) {
      throw new Error('Render workspace lookup returned no owner id');
    }

    return ownerId;
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

  private assertOk(response: Response, message: string): void {
    if (!response.ok) {
      throw new Error(`${message}: ${response.status}`);
    }
  }
}
