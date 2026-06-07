import { createSign } from 'node:crypto';

import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sodium from 'libsodium-wrappers';

import type { AppConfig } from '../../config/app.config';
import type { CreateRepoDto } from './dto/create-repo.dto';
import {
  GithubInstallationsRepository,
  type GithubInstallation,
  type GithubInstallationRepo,
} from './github-installations.repository';

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  html_url: string;
  updated_at: string;
}

interface GitHubInstallationMetadataResponse {
  account?: {
    login?: string | null;
    id?: number | null;
  };
  repository_selection?: 'all' | 'selected';
}

interface GitHubInstallationRepositoriesResponse {
  repositories?: Array<{ full_name?: string }>;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  sha?: string;
}

interface GitHubContentsWriteResponse {
  content?: { html_url?: string };
  commit?: { sha?: string; html_url?: string };
}

interface GitHubPullRequestResponse {
  number?: number;
  html_url?: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly appId: string;
  private readonly appSlug: string;
  private readonly appPrivateKey: string;

  constructor(
    @Optional() private readonly configService: ConfigService | null,
    @Optional()
    private readonly githubInstallationsRepository: GithubInstallationsRepository | null,
  ) {
    const config = this.configService?.get<AppConfig>('app');
    this.appId = config?.github.appId ?? '';
    this.appSlug = config?.github.appSlug ?? 'my-github-app';
    this.appPrivateKey = config?.github.appPrivateKey ?? '';
  }

  getAppInstallUrl(): string {
    return `https://github.com/apps/${this.appSlug}/installations/new`;
  }

  createAppJwt(nowSeconds = Math.floor(Date.now() / 1000)): string {
    if (!this.appId || !this.appPrivateKey) {
      throw new UnprocessableEntityException(
        'GitHub App credentials are not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.',
      );
    }

    const header = this.base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = this.base64UrlJson({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: this.appId,
    });
    const unsigned = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.appPrivateKey, 'base64url');

    return `${unsigned}.${signature}`;
  }

  async createInstallationAccessToken(installationId: number): Promise<string> {
    const response = await fetch(
      `https://api.github.com/app/installations/${String(installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.createAppJwt()}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new BadGatewayException(
        `GitHub installation token request failed (${String(response.status)}): ${body}`,
      );
    }

    const payload = (await response.json()) as { token?: string };
    if (!payload.token) {
      throw new BadGatewayException('GitHub installation token response did not include a token');
    }

    return payload.token;
  }

  async getInstallationAccessTokenForUser(userId: string): Promise<string | null> {
    if (!this.githubInstallationsRepository) return null;

    const installations = await this.githubInstallationsRepository.findByUserId(userId);
    const installation =
      installations.find((item) => item.repositorySelection === 'all') ?? installations[0];

    if (!installation) return null;

    try {
      return await this.createInstallationAccessToken(installation.installationId);
    } catch (error) {
      this.logger.warn(
        `Could not create installation token for user ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async linkInstallation(
    userId: string,
    installationId: number,
  ): Promise<{ reposLinked: number; repositorySelection: 'all' | 'selected' }> {
    let reposLinked = 0;
    let repositorySelection: 'all' | 'selected' = 'selected';
    let accountLogin: string | null = null;
    let accountId: number | null = null;
    let repoFullNames: string[] = [];

    try {
      const metadata = await this.fetchInstallationMetadata(installationId);
      accountLogin = metadata.account?.login ?? null;
      accountId = metadata.account?.id ?? null;
      repositorySelection = metadata.repository_selection ?? 'selected';

      const installationToken = await this.createInstallationAccessToken(installationId);
      repoFullNames = await this.fetchInstallationRepositories(installationToken);
      reposLinked = repoFullNames.length;
    } catch (error) {
      this.logger.warn(
        `Could not fully inspect installation ${installationId}: ${(error as Error).message}`,
      );
    }

    if (this.githubInstallationsRepository) {
      try {
        const saved = await this.githubInstallationsRepository.upsert(
          userId,
          installationId,
          accountLogin,
          accountId,
          repositorySelection,
          reposLinked,
        );

        if (repoFullNames.length > 0) {
          await this.githubInstallationsRepository.replaceRepos(
            installationId,
            repoFullNames,
          );
        }

        reposLinked = saved.reposLinked;
        repositorySelection = saved.repositorySelection;
      } catch (error) {
        this.logger.warn(
          `Could not persist installation ${installationId}: ${(error as Error).message}`,
        );
      }
    }

    return { reposLinked, repositorySelection };
  }

  async listLinkedRepos(userId: string): Promise<GithubInstallationRepo[]> {
    if (!this.githubInstallationsRepository) return [];
    try {
      return await this.githubInstallationsRepository.findReposByUserId(userId);
    } catch (error) {
      this.logger.warn(
        `Could not fetch linked repos for user ${userId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  async listInstallationAccounts(userId: string): Promise<GithubInstallation[]> {
    if (!this.githubInstallationsRepository) return [];
    try {
      return await this.githubInstallationsRepository.findByUserId(userId);
    } catch (error) {
      this.logger.warn(
        `Could not fetch installations for user ${userId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Returns true if the repository exists and the token has access to it.
   * Returns false on 404 (deleted or never existed) or 403/401 (no access).
   * Throws on unexpected non-2xx/4xx statuses (5xx, network errors).
   */
  async repoExists(accessToken: string, repoFullName: string): Promise<boolean> {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (response.status === 200) return true;
    if (response.status === 404 || response.status === 403 || response.status === 401) return false;

    const body = await response.text();
    throw new BadGatewayException(
      `GitHub repo existence check failed (${String(response.status)}): ${body}`,
    );
  }

  async listRepos(accessToken: string): Promise<GitHubRepo[]> {
    const response = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated&type=all',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as GitHubRepoResponse[];
    return payload.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      description: repo.description,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
      updatedAt: repo.updated_at,
    }));
  }

  async createRepo(
    accessToken: string,
    dto: CreateRepoDto,
  ): Promise<{
    repoUrl: string;
    cloneUrl: string;
    ownerLogin: string;
    repoName: string;
  }> {
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cicd-workflow-product',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: dto.repoName,
        description: dto.description ?? '',
        private: dto.private,
        auto_init: true,
        default_branch: 'main',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403 || response.status === 401) {
        throw new ForbiddenException(
          `GitHub rejected repo creation (${String(response.status)}). ` +
            `Ensure your OAuth token includes the 'repo' scope, then sign out and sign back in.`,
        );
      }
      if (response.status === 422) {
        throw new UnprocessableEntityException(
          `Repository already exists or name is invalid: ${body}`,
        );
      }
      throw new BadGatewayException(
        `GitHub repo creation failed (${String(response.status)}): ${body}`,
      );
    }

    const repo = (await response.json()) as {
      html_url: string;
      clone_url: string;
      owner: { login: string };
      name: string;
    };

    return {
      repoUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      ownerLogin: repo.owner.login,
      repoName: repo.name,
    };
  }

  async createBranch(
    accessToken: string,
    owner: string,
    repo: string,
    branchName: string,
    fromBranch: string,
  ): Promise<void> {
    let ref: { object: { sha: string } } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
      const refRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'cicd-workflow-product',
          },
        },
      );
      if (refRes.ok) {
        ref = (await refRes.json()) as { object: { sha: string } };
        break;
      }
    }
    if (!ref) {
      throw new BadGatewayException(
        `Could not resolve '${fromBranch}' branch on GitHub after retries. ` +
        'The repository may not have initialised yet; please retry in a few seconds.',
      );
    }

    const createRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: ref.object.sha,
        }),
      },
    );
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new BadGatewayException(
        `Branch '${branchName}' creation failed (${String(createRes.status)}): ${err}`,
      );
    }
  }

  async getFileContent(
    accessToken: string,
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
  ): Promise<string | null> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new BadGatewayException(
        `GitHub file read failed (${String(response.status)}): ${body}`,
      );
    }

    const payload = (await response.json()) as GitHubContentResponse;
    if (!payload.content || payload.encoding !== 'base64') {
      return null;
    }

    return Buffer.from(payload.content, 'base64').toString('utf8');
  }

  async putFileContent(
    accessToken: string,
    owner: string,
    repo: string,
    filePath: string,
    content: string,
    branch: string,
    message: string,
  ): Promise<{ commitSha: string; commitUrl: string | null }> {
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');
    let existingSha: string | undefined;

    const checkRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (checkRes.ok) {
      const existing = (await checkRes.json()) as GitHubContentResponse;
      existingSha = existing.sha;
    } else if (checkRes.status !== 404) {
      const body = await checkRes.text();
      throw new BadGatewayException(
        `GitHub file lookup failed (${String(checkRes.status)}): ${body}`,
      );
    }

    const body: Record<string, unknown> = {
      message,
      content: encodedContent,
      branch,
    };

    if (existingSha) {
      body.sha = existingSha;
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!putRes.ok) {
      const errorBody = await putRes.text();
      throw new BadGatewayException(
        `GitHub file write failed (${String(putRes.status)}): ${errorBody}`,
      );
    }

    const payload = (await putRes.json()) as GitHubContentsWriteResponse;
    return {
      commitSha: payload.commit?.sha ?? '',
      commitUrl: payload.commit?.html_url ?? payload.content?.html_url ?? null,
    };
  }

  async createPullRequest(
    accessToken: string,
    owner: string,
    repo: string,
    pullRequest: { title: string; head: string; base: string; body?: string },
  ): Promise<{ number: number; htmlUrl: string }> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pullRequest),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new BadGatewayException(
        `GitHub pull request creation failed (${String(response.status)}): ${body}`,
      );
    }

    const payload = (await response.json()) as GitHubPullRequestResponse;
    if (!payload.number || !payload.html_url) {
      throw new BadGatewayException('GitHub pull request response was incomplete');
    }

    return { number: payload.number, htmlUrl: payload.html_url };
  }

  async setActionsSecret(
    accessToken: string | null | undefined,
    owner: string,
    repo: string,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    if (!accessToken) {
      this.logger.warn(`setActionsSecret: no token available for ${owner}/${repo}/${secretName}, skipping`);
      return;
    }

    const keyRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!keyRes.ok) {
      const body = await keyRes.text();
      this.logger.warn(`setActionsSecret: failed to fetch public key for ${owner}/${repo} (${String(keyRes.status)}): ${body}`);
      return;
    }

    const keyPayload = (await keyRes.json()) as { key_id: string; key: string };

    await sodium.ready;
    const keyBytes = sodium.from_base64(keyPayload.key, sodium.base64_variants.ORIGINAL);
    const secretBytes = sodium.from_string(secretValue);
    const encryptedBytes = sodium.crypto_box_seal(secretBytes, keyBytes);
    const encryptedValue = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyPayload.key_id }),
      },
    );

    if (!putRes.ok && putRes.status !== 204) {
      const body = await putRes.text();
      this.logger.warn(`setActionsSecret: failed to set ${secretName} on ${owner}/${repo} (${String(putRes.status)}): ${body}`);
    }
  }

  async applyBranchProtection(
    accessToken: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<void> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          required_status_checks: null,
          enforce_admins: false,
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            require_code_owner_reviews: false,
            required_approving_review_count: 1,
          },
          restrictions: null,
          allow_force_pushes: false,
          allow_deletions: false,
        }),
      },
    );
    if (!res.ok) {
      this.logger.warn(`Branch protection on ${branch} failed (${String(res.status)}); continuing`);
    }
  }

  private async fetchInstallationMetadata(
    installationId: number,
  ): Promise<GitHubInstallationMetadataResponse> {
    const response = await fetch(
      `https://api.github.com/app/installations/${String(installationId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.createAppJwt()}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new BadGatewayException(
        `GitHub installation metadata request failed (${String(response.status)}): ${body}`,
      );
    }

    return (await response.json()) as GitHubInstallationMetadataResponse;
  }

  private async fetchInstallationRepositories(accessToken: string): Promise<string[]> {
    const response = await fetch(
      'https://api.github.com/installation/repositories?per_page=100',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new BadGatewayException(
        `GitHub installation repositories request failed (${String(response.status)}): ${body}`,
      );
    }

    const payload = (await response.json()) as GitHubInstallationRepositoriesResponse;
    return (payload.repositories ?? [])
      .map((repo) => repo.full_name)
      .filter((repoFullName): repoFullName is string => Boolean(repoFullName));
  }

  private base64UrlJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }
}
