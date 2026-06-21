import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export type PlatformRole = 'admin' | 'super_admin';

export interface PlatformAdminRecord {
  userId: string;
  login: string;
  displayName: string | null;
  role: PlatformRole;
  grantedBy: string | null;
  grantedAt: string;
}

interface PlatformAdminRow {
  user_id: string;
  login: string;
  display_name: string | null;
  role: PlatformRole;
  granted_by: string | null;
  granted_at: string;
}

/**
 * Data access for the platform-level admin grants in identity.platform_admins.
 * Absence of a row means the user is an ordinary user (no platform role).
 */
@Injectable()
export class PlatformAdminsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /** Returns the user's platform role, or null if they are not a platform admin. */
  async findRole(userId: string): Promise<PlatformRole | null> {
    const result = await this.databaseService.query<{ role: PlatformRole }>(
      `SELECT role FROM identity.platform_admins WHERE user_id = $1 LIMIT 1;`,
      [userId],
    );
    return result.rows[0]?.role ?? null;
  }

  async list(): Promise<PlatformAdminRecord[]> {
    const result = await this.databaseService.query<PlatformAdminRow>(
      `
        SELECT pa.user_id, u.login, u.display_name, pa.role, pa.granted_by, pa.granted_at
        FROM identity.platform_admins AS pa
        JOIN identity.app_users AS u ON u.id = pa.user_id
        ORDER BY pa.granted_at ASC;
      `,
    );
    return result.rows.map((row) => this.toRecord(row));
  }

  /** Idempotent upsert — grants or changes a user's platform role. */
  async grant(
    userId: string,
    role: PlatformRole,
    grantedBy: string,
  ): Promise<void> {
    await this.databaseService.query(
      `
        INSERT INTO identity.platform_admins (user_id, role, granted_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id)
        DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW();
      `,
      [userId, role, grantedBy],
    );
  }

  async revoke(userId: string): Promise<void> {
    await this.databaseService.query(
      `DELETE FROM identity.platform_admins WHERE user_id = $1;`,
      [userId],
    );
  }

  /** Number of super-admins — used to prevent removing the last one. */
  async countSuperAdmins(): Promise<number> {
    const result = await this.databaseService.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM identity.platform_admins WHERE role = 'super_admin';`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  private toRecord(row: PlatformAdminRow): PlatformAdminRecord {
    return {
      userId: row.user_id,
      login: row.login,
      displayName: row.display_name,
      role: row.role,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
    };
  }
}
