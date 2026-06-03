import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
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
    @Optional() private readonly githubInstallationsRepository: GithubInstallationsRepository | null,
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
    // A production implementation would call
    //   GET /app/installations/:installation_id  (GitHub App JWT auth)
    // to obtain account_login, account_id, repository_selection, etc.

    let reposLinked = 0;
    let repositorySelection: 'all' | 'selected' = 'selected';

    if (this.githubInstallationsRepository) {
      try {
        const saved = await this.githubInstallationsRepository.upsert(
          userId,
          installationId,
          null,   // accountLogin — resolved asynchronously in a full implementation
          null,   // accountId
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
    dto: import('./dto/create-repo.dto.js').CreateRepoDto,
  ): Promise<{ repoUrl: string; cloneUrl: string; ownerLogin: string; repoName: string }> {
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
      const err = await response.text();
      throw new Error(`GitHub repo creation failed (${String(response.status)}): ${err}`);
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
    if (!refRes.ok) {
      throw new Error(`Could not resolve ref for ${fromBranch}`);
    }
    const ref = (await refRes.json()) as { object: { sha: string } };

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
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: ref.object.sha }),
      },
    );
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Branch ${branchName} creation failed: ${err}`);
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
      this.logger.warn(`Branch protection on ${branch} failed (${String(res.status)}) — continuing`);
    }
  }
}
