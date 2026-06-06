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

interface GitHubActionsPublicKeyResponse {
  key_id: string;
  key: string;
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
  private readonly appSlug: string;

  constructor(
    @Optional() private readonly configService: ConfigService | null,
    @Optional()
    private readonly githubInstallationsRepository: GithubInstallationsRepository | null,
  ) {
    const config = this.configService?.get<AppConfig>('app');
    this.appSlug = config?.github.appSlug ?? 'my-github-app';
  }

  /** Build the GitHub App installation URL from the configured app slug. */
  getAppInstallUrl(): string {
    return `https://github.com/apps/${this.appSlug}/installations/new`;
  }

  /**
   * Fetch installation metadata from GitHub and persist it for the given user.
   * Falls back gracefully when the DB is unavailable.
   */
  async linkInstallation(
    userId: string,
    installationId: number,
  ): Promise<{ reposLinked: number; repositorySelection: 'all' | 'selected' }> {
    // TODO: call GET /app/installations/:installation_id (GitHub App JWT auth) to obtain
    // account_login, account_id, and repository_selection from GitHub rather than defaulting.
    // Defaulting to 'all' unblocks repo creation until real JWT verification is implemented.

    let reposLinked = 0;
    let repositorySelection: 'all' | 'selected' = 'all';

    if (this.githubInstallationsRepository) {
      try {
        const saved = await this.githubInstallationsRepository.upsert(
          userId,
          installationId,
          null, // accountLogin — resolved asynchronously in a full implementation
          null, // accountId
          repositorySelection,
          reposLinked,
        );
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

  /** Return repos linked via GitHub App installations for the given user. */
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

  /** Return GitHub App installation accounts for the given user. */
  async listInstallationAccounts(
    userId: string,
  ): Promise<GithubInstallation[]> {
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
    // GitHub initialises the default branch asynchronously after repo creation.
    // Retry resolving the ref for up to ~10 s before giving up.
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
          `The repository may not have initialised yet — please retry in a few seconds.`,
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
      this.logger.warn(
        `Branch protection on ${branch} failed (${String(res.status)}) — continuing`,
      );
    }
  }

  async setActionsSecret(
    accessToken: string,
    owner: string,
    repo: string,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    const publicKeyRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cicd-workflow-product',
        },
      },
    );

    if (!publicKeyRes.ok) {
      const body = await publicKeyRes.text();
      throw new BadGatewayException(
        `GitHub Actions public key lookup failed (${String(publicKeyRes.status)}): ${body}`,
      );
    }

    const publicKey =
      (await publicKeyRes.json()) as GitHubActionsPublicKeyResponse;
    await sodium.ready;

    const encryptedValue = sodium.to_base64(
      sodium.crypto_box_seal(
        sodium.from_string(secretValue),
        sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL),
      ),
      sodium.base64_variants.ORIGINAL,
    );

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
        body: JSON.stringify({
          encrypted_value: encryptedValue,
          key_id: publicKey.key_id,
        }),
      },
    );

    if (!putRes.ok) {
      const body = await putRes.text();
      throw new BadGatewayException(
        `GitHub Actions secret installation failed (${String(putRes.status)}): ${body}`,
      );
    }
  }
}
