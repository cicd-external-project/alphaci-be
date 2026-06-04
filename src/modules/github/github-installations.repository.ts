import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

interface GithubInstallationRow {
  installation_id: number;
  user_id: string;
  account_login: string | null;
  account_id: number | null;
  repository_selection: 'all' | 'selected';
  repos_linked: number;
  created_at: string;
}

interface GithubInstallationRepoRow {
  installation_id: number;
  repo_full_name: string;
}

export interface GithubInstallation {
  installationId: number;
  userId: string;
  accountLogin: string | null;
  accountId: number | null;
  repositorySelection: 'all' | 'selected';
  reposLinked: number;
}

export interface GithubInstallationRepo {
  installationId: number;
  repoFullName: string;
}

@Injectable()
export class GithubInstallationsRepository {
  private readonly logger = new Logger(GithubInstallationsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Upsert a GitHub App installation record for the given user.
   * Returns the stored installation row.
   */
  async upsert(
    userId: string,
    installationId: number,
    accountLogin: string | null,
    accountId: number | null,
    repositorySelection: 'all' | 'selected',
    reposLinked: number,
  ): Promise<GithubInstallation> {
    const result = await this.databaseService.query<GithubInstallationRow>(
      `
        INSERT INTO github_installations (
          installation_id,
          user_id,
          account_login,
          account_id,
          repository_selection,
          repos_linked
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (installation_id)
        DO UPDATE SET
          user_id              = EXCLUDED.user_id,
          account_login        = EXCLUDED.account_login,
          account_id           = EXCLUDED.account_id,
          repository_selection = EXCLUDED.repository_selection,
          repos_linked         = EXCLUDED.repos_linked,
          updated_at           = NOW()
        RETURNING
          installation_id,
          user_id,
          account_login,
          account_id,
          repository_selection,
          repos_linked,
          created_at;
      `,
      [userId, installationId, accountLogin, accountId, repositorySelection, reposLinked],
    );

    const row = result.rows[0];
    if (!row) throw new Error('github_installations upsert returned no row');
    return this.toInstallation(row);
  }

  /** Return all installations belonging to the given user. */
  async findByUserId(userId: string): Promise<GithubInstallation[]> {
    const result = await this.databaseService.query<GithubInstallationRow>(
      `
        SELECT
          installation_id,
          user_id,
          account_login,
          account_id,
          repository_selection,
          repos_linked,
          created_at
        FROM github_installations
        WHERE user_id = $1
        ORDER BY created_at DESC;
      `,
      [userId],
    );

    return result.rows.map((row) => this.toInstallation(row));
  }

  /** Return all repos linked to installations belonging to the given user. */
  async findReposByUserId(userId: string): Promise<GithubInstallationRepo[]> {
    const result = await this.databaseService.query<GithubInstallationRepoRow>(
      `
        SELECT
          r.installation_id,
          r.repo_full_name
        FROM github_installation_repos r
        INNER JOIN github_installations i ON i.installation_id = r.installation_id
        WHERE i.user_id = $1
        ORDER BY r.repo_full_name;
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      installationId: row.installation_id,
      repoFullName: row.repo_full_name,
    }));
  }

  async replaceRepos(
    installationId: number,
    repoFullNames: string[],
  ): Promise<void> {
    await this.databaseService.query(
      'DELETE FROM github_installation_repos WHERE installation_id = $1;',
      [installationId],
    );

    if (repoFullNames.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders = repoFullNames.map((repoFullName, index) => {
      values.push(installationId, repoFullName);
      const base = index * 2;
      return `($${base + 1}, $${base + 2})`;
    });

    await this.databaseService.query(
      `
        INSERT INTO github_installation_repos (installation_id, repo_full_name)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (installation_id, repo_full_name) DO NOTHING;
      `,
      values,
    );
  }

  private toInstallation(row: GithubInstallationRow): GithubInstallation {
    return {
      installationId: row.installation_id,
      userId: row.user_id,
      accountLogin: row.account_login,
      accountId: row.account_id,
      repositorySelection: row.repository_selection,
      reposLinked: row.repos_linked,
    };
  }
}
