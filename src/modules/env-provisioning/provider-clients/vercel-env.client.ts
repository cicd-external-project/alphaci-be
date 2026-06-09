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

const VERCEL_API_URL = 'https://api.vercel.com';
const VERCEL_TARGET_BY_ENV = {
  test: 'preview',
  uat: 'preview',
  production: 'production',
} as const;

@Injectable()
export class VercelEnvClient implements RuntimeEnvProviderClient {
  readonly provider = 'vercel' as const;

  constructor(private readonly configService?: ConfigService) {}

  async validateConnection(token: string): Promise<ProviderAccountSummary> {
    const response = await fetch(this.withScope(`${VERCEL_API_URL}/v2/user`), {
      headers: this.headers(token),
    });
    await this.assertOk(response, 'Vercel connection validation failed');
    const payload = (await response.json()) as {
      user?: { uid?: string; username?: string; name?: string };
    };

    return {
      id: payload.user?.uid ?? 'vercel-account',
      name: payload.user?.name ?? payload.user?.username ?? 'Vercel account',
    };
  }

  async listTargets(token: string): Promise<ProviderDeploymentTarget[]> {
    const response = await fetch(
      this.withScope(`${VERCEL_API_URL}/v9/projects`),
      {
        headers: this.headers(token),
      },
    );
    await this.assertOk(response, 'Vercel projects could not be loaded');
    const payload = (await response.json()) as {
      projects?: Array<{ id?: string; name?: string }>;
    };

    return (payload.projects ?? [])
      .filter((project): project is { id: string; name: string } =>
        Boolean(project.id && project.name),
      )
      .map((project) => ({
        id: project.id,
        name: project.name,
        provider: this.provider,
      }));
  }

  async createTarget(
    input: CreateProviderTargetInput,
  ): Promise<ProviderDeploymentTarget> {
    const [owner, repo] = input.repoFullName.split('/');
    const rootDirectory = this.normalizeRootDirectory(input.rootDirectory);
    const response = await fetch(
      this.withScope(`${VERCEL_API_URL}/v11/projects`),
      {
        method: 'POST',
        headers: this.headers(input.token),
        body: JSON.stringify({
          name: input.projectName,
          gitRepository:
            owner && repo
              ? {
                  type: 'github',
                  repo: input.repoFullName,
                }
              : undefined,
          rootDirectory,
          buildCommand: input.buildCommand,
        }),
      },
    );
    await this.assertOk(response, 'Vercel project could not be created');
    const payload = (await response.json()) as { id?: string; name?: string };
    if (!payload.id || !payload.name) {
      throw new Error('Vercel project creation returned an invalid response');
    }

    return {
      id: payload.id,
      name: payload.name,
      provider: this.provider,
    };
  }

  async upsertEnvironmentVariables(
    input: UpsertProviderEnvInput,
  ): Promise<ProviderProvisionResult> {
    for (const variable of input.vars) {
      const response = await fetch(
        this.withScope(
          `${VERCEL_API_URL}/v10/projects/${input.targetId}/env?upsert=true`,
        ),
        {
          method: 'POST',
          headers: this.headers(input.token),
          body: JSON.stringify({
            key: variable.key,
            value: variable.value,
            type: 'sensitive',
            target: [VERCEL_TARGET_BY_ENV[input.environment]],
          }),
        },
      );
      await this.assertOk(response, 'Vercel env var could not be updated');
    }

    return {
      provisioned: input.vars.map((variable) => ({
        key: variable.key,
        status: 'provisioned',
      })),
      failed: [],
    };
  }

  private withScope(url: string): string {
    const config = this.configService?.getOrThrow<AppConfig>('app');
    const teamId =
      config?.envProvisioning.flowciManaged.vercelTeamId?.trim() ?? '';
    const slug =
      config?.envProvisioning.flowciManaged.vercelTeamSlug?.trim() ?? '';
    if (!teamId && !slug) {
      return url;
    }

    const scopedUrl = new URL(url);
    if (teamId) {
      scopedUrl.searchParams.set('teamId', teamId);
    } else {
      scopedUrl.searchParams.set('slug', slug);
    }

    return scopedUrl.toString();
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private normalizeRootDirectory(
    rootDirectory: string | null | undefined,
  ): string | undefined {
    const normalized = rootDirectory?.trim().replace(/\\/g, '/');
    if (!normalized || normalized === '.') {
      return undefined;
    }

    const withoutLeadingDotSlash = normalized.replace(/^(\.\/)+/, '');
    if (
      !withoutLeadingDotSlash ||
      withoutLeadingDotSlash.startsWith('/') ||
      withoutLeadingDotSlash.includes('..')
    ) {
      return undefined;
    }

    return withoutLeadingDotSlash;
  }

  private async assertOk(response: Response, message: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const summary = body ? ` ${body.slice(0, 300)}` : '';
      throw new Error(`${message}: ${response.status}${summary}`);
    }
  }
}
