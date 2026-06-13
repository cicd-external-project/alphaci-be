import { Injectable } from '@nestjs/common';

import type { SessionUser } from '../../common/interfaces/session-user.interface';
import { DatabaseService } from '../database/database.service';

interface UpsertGitHubUserInput {
  githubUserId: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

interface UpsertGoogleUserInput {
  googleUserId: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

interface PersistedUserRow {
  id: string;
  login: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  onboarding_completed_at: string | null;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async upsertGitHubUser(input: UpsertGitHubUserInput): Promise<SessionUser> {
    const normalizedLogin = this.normalizeLogin(
      input.login,
      input.githubUserId,
    );

    const query = `
      WITH candidate AS (
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM app_users
            WHERE login = $2
              AND COALESCE(github_user_id, '') <> $1
          )
            THEN CONCAT($2, '-', SUBSTRING(md5($1) FROM 1 FOR 6))
            ELSE $2
        END AS safe_login
      )
      INSERT INTO app_users (
        github_user_id,
        login,
        display_name,
        email,
        avatar_url,
        provider,
        is_dummy,
        last_login_at
      )
      VALUES ($1, (SELECT safe_login FROM candidate), $3, $4, $5, 'github', false, NOW())
      ON CONFLICT (github_user_id)
      DO UPDATE SET
        login = EXCLUDED.login,
        display_name = EXCLUDED.display_name,
        email = COALESCE(EXCLUDED.email, app_users.email),
        avatar_url = EXCLUDED.avatar_url,
        provider = 'github',
        is_dummy = false,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING id, login, display_name, email, avatar_url, onboarding_completed_at;
    `;

    const result = await this.databaseService.query<PersistedUserRow>(query, [
      input.githubUserId,
      normalizedLogin,
      input.name ?? input.login,
      input.email ?? null,
      input.avatarUrl ?? null,
    ]);

    const row = result.rows[0];
    if (!row) throw new Error('Upsert returned no row');
    return this.toSessionUser(row);
  }

  async upsertGoogleUser(input: UpsertGoogleUserInput): Promise<SessionUser> {
    const normalizedLogin = this.normalizeLogin(
      input.login,
      input.googleUserId,
      'google',
    );

    const query = `
      INSERT INTO app_users (
        login,
        display_name,
        email,
        avatar_url,
        provider,
        is_dummy,
        last_login_at
      )
      VALUES ($1, $2, $3, $4, 'google', false, NOW())
      ON CONFLICT (login)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = COALESCE(EXCLUDED.email, app_users.email),
        avatar_url = EXCLUDED.avatar_url,
        provider = 'google',
        is_dummy = false,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING id, login, display_name, email, avatar_url, onboarding_completed_at;
    `;

    const result = await this.databaseService.query<PersistedUserRow>(query, [
      normalizedLogin,
      input.name ?? input.login,
      input.email ?? null,
      input.avatarUrl ?? null,
    ]);

    const row = result.rows[0];
    if (!row) throw new Error('Upsert returned no row');
    return this.toSessionUser(row);
  }

  async deleteById(userId: string): Promise<void> {
    await this.databaseService.query(
      `DELETE FROM app_users WHERE id = $1;`,
      [userId],
    );
  }

  async findById(userId: string): Promise<SessionUser | null> {
    const result = await this.databaseService.query<PersistedUserRow>(
      `
        SELECT id, login, display_name, email, avatar_url, onboarding_completed_at
        FROM app_users
        WHERE id = $1
        LIMIT 1;
      `,
      [userId],
    );

    const row = result.rows[0];
    return row ? this.toSessionUser(row) : null;
  }

  async markOnboardingComplete(userId: string): Promise<void> {
    await this.databaseService.query(
      `UPDATE app_users
         SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
             updated_at = NOW()
       WHERE id = $1;`,
      [userId],
    );
  }

  private toSessionUser(row: PersistedUserRow): SessionUser {
    return {
      id: row.id,
      login: row.login,
      name: row.display_name ?? row.login,
      ...(row.email != null && { email: row.email }),
      ...(row.avatar_url != null && { avatarUrl: row.avatar_url }),
      onboardingCompleted: row.onboarding_completed_at != null,
    };
  }

  private normalizeLogin(
    login: string,
    providerUserId: string,
    provider = 'github',
  ): string {
    const normalized = login
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-+|-+$/g, '');

    if (normalized) {
      return normalized;
    }

    return `${provider}-${providerUserId.slice(0, 24)}`;
  }
}
