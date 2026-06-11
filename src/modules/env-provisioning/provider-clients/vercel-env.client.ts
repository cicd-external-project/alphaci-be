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
    const accountId = payload.user?.uid ?? 'vercel-account';

    return {
      id: accountId,
      name: payload.user?.name ?? payload.user?.username ?? 'Vercel account',
      metadata: {
        accountType: 'user',
        orgId: accountId,
      },
    };
  }

  async validateTeamAccess(
    token: string,
    teamId: string,
  ): Promise<{ id: string; slug?: string; name?: string }> {
    const response = await fetch(`${VERCEL_API_URL}/v2/teams/${teamId}`, {
      headers: this.headers(token),
    });
    await this.assertOk(response, 'Vercel team access validation failed');
    const payload = (await response.json()) as {
      id?: string;
      slug?: string;
      name?: string;
    };
    if (!payload.id) {
      throw new Error('Vercel team validation returned an invalid response');
    }

    return {
      id: payload.id,
      ...(payload.slug ? { slug: payload.slug } : {}),
      ...(payload.name ? { name: payload.name } : {}),
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
    const shouldConnectGit =
      input.deploymentStrategy !== 'vercel_ci_pushed' && Boolean(owner && repo);
    const vercelOrgId = this.resolveVercelOrgId(input);
    const response = await fetch(
      this.withTargetScope(`${VERCEL_API_URL}/v11/projects`, input),
      {
        method: 'POST',
        headers: this.headers(input.token),
        body: JSON.stringify({
          name: input.projectName,
          ...(shouldConnectGit
            ? {
                gitRepository: {
                  type: 'github',
                  repo: input.repoFullName,
                },
              }
            : {}),
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
      metadata: {
        deploymentStrategy: input.deploymentStrategy ?? 'vercel_git_connected',
        vercelProjectId: payload.id,
        vercelOrgId,
        ...(input.vercelTeamId ? { vercelTeamId: input.vercelTeamId } : {}),
        ...(input.vercelTeamSlug
          ? { vercelTeamSlug: input.vercelTeamSlug }
          : {}),
        gitConnected: shouldConnectGit,
      },
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

  private withTargetScope(
    url: string,
    input: CreateProviderTargetInput,
  ): string {
    const teamId = input.vercelTeamId?.trim();
    const slug = input.vercelTeamSlug?.trim();
    if (teamId || slug) {
      const scopedUrl = new URL(url);
      if (teamId) {
        scopedUrl.searchParams.set('teamId', teamId);
      } else if (slug) {
        scopedUrl.searchParams.set('slug', slug);
      }

      return scopedUrl.toString();
    }

    if (input.deploymentStrategy === 'vercel_ci_pushed') {
      return url;
    }

    return this.withScope(url);
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

  private resolveVercelOrgId(input: CreateProviderTargetInput): string {
    if (input.vercelOrgId?.trim()) {
      return input.vercelOrgId.trim();
    }

    if (input.vercelTeamId?.trim()) {
      return input.vercelTeamId.trim();
    }

    if (input.deploymentStrategy === 'vercel_ci_pushed') {
      throw new Error(
        'Vercel org id is required when creating CI-pushed deployment targets',
      );
    }

    return 'vercel-account';
  }

  private async assertOk(response: Response, message: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const actionableError = this.toActionableError(body);
      if (actionableError) {
        throw new Error(actionableError);
      }

      const summary = body ? ` ${body.slice(0, 300)}` : '';
      throw new Error(`${message}: ${response.status}${summary}`);
    }
  }

  private toActionableError(body: string): string | null {
    if (!body) {
      return null;
    }

    let payload: {
      error?: {
        action?: string;
        code?: string;
        link?: string;
        message?: string;
        repo?: string;
      };
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      return null;
    }

    const error = payload.error;
    if (
      error?.action !== 'Install GitHub App' ||
      !error.message?.includes('install the GitHub integration')
    ) {
      return null;
    }

    const repo = error.repo?.trim() || 'the GitHub repository';
    return (
      `Vercel GitHub integration is not installed or does not have access to ${repo}. ` +
      'Install the Vercel GitHub App for that GitHub owner and grant repository access, then retry.'
    );
  }
}
