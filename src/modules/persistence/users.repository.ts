import { Injectable } from "@nestjs/common";

import type { SessionUser } from "../../common/interfaces/session-user.interface";
import { DatabaseService } from "../database/database.service";

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
}

@Injectable()
export class UsersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async upsertGitHubUser(input: UpsertGitHubUserInput): Promise<SessionUser> {
    const normalizedLogin = this.normalizeLogin(input.login, "github", input.githubUserId);

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
      RETURNING id, login, display_name, email, avatar_url;
    `;

    const result = await this.databaseService.query<PersistedUserRow>(query, [
      input.githubUserId,
      normalizedLogin,
      input.name ?? input.login,
      input.email ?? null,
      input.avatarUrl ?? null,
    ]);

    const row = result.rows[0];
    return this.toSessionUser(row);
  }

  async upsertGoogleUser(input: UpsertGoogleUserInput): Promise<SessionUser> {
    const normalizedLogin = this.normalizeLogin(input.login, "google", input.googleUserId);

    const query = `
      WITH candidate AS (
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM app_users
            WHERE login = $2
              AND COALESCE(google_user_id, '') <> $1
          )
            THEN CONCAT($2, '-', SUBSTRING(md5($1) FROM 1 FOR 6))
            ELSE $2
        END AS safe_login
      )
      INSERT INTO app_users (
        google_user_id,
        login,
        display_name,
        email,
        avatar_url,
        provider,
        is_dummy,
        last_login_at
      )
      VALUES ($1, (SELECT safe_login FROM candidate), $3, $4, $5, 'google', false, NOW())
      ON CONFLICT (google_user_id)
      DO UPDATE SET
        login = EXCLUDED.login,
        display_name = EXCLUDED.display_name,
        email = COALESCE(EXCLUDED.email, app_users.email),
        avatar_url = EXCLUDED.avatar_url,
        provider = 'google',
        is_dummy = false,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING id, login, display_name, email, avatar_url;
    `;

    const result = await this.databaseService.query<PersistedUserRow>(query, [
      input.googleUserId,
      normalizedLogin,
      input.name ?? input.login,
      input.email ?? null,
      input.avatarUrl ?? null,
    ]);

    const row = result.rows[0];
    return this.toSessionUser(row);
  }

  async findById(userId: string): Promise<SessionUser | null> {
    const result = await this.databaseService.query<PersistedUserRow>(
      `
        SELECT id, login, display_name, email, avatar_url
        FROM app_users
        WHERE id = $1
        LIMIT 1;
      `,
      [userId],
    );

    const row = result.rows[0];
    return row ? this.toSessionUser(row) : null;
  }

  private toSessionUser(row: PersistedUserRow): SessionUser {
    return {
      id: row.id,
      login: row.login,
      name: row.display_name ?? row.login,
      email: row.email ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
    };
  }

  private normalizeLogin(login: string, provider: "github" | "google", providerUserId: string): string {
    const normalized = login
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-+|-+$/g, "");

    if (normalized) {
      return normalized;
    }

    return `${provider}-${providerUserId.slice(0, 24)}`;
  }
}
