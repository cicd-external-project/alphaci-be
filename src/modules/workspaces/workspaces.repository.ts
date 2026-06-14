import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: 'owner' | 'admin' | 'developer' | 'viewer';
}

interface WorkspaceRow {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: 'owner' | 'admin' | 'developer' | 'viewer';
}

@Injectable()
export class WorkspacesRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const result = await this.databaseService.query<WorkspaceRow>(
      `
        SELECT
          workspace.id,
          workspace.name,
          workspace.kind,
          member.role
        FROM orgs.workspace_members AS member
        JOIN orgs.workspaces AS workspace
          ON workspace.id = member.workspace_id
        WHERE member.user_id = $1
        ORDER BY workspace.created_at ASC;
      `,
      [userId],
    );

    return result.rows.map((row) => this.toSummary(row));
  }

  async createPersonalWorkspace(userId: string): Promise<WorkspaceSummary> {
    const workspaceResult = await this.databaseService.query<WorkspaceRow>(
      `
        INSERT INTO orgs.workspaces (owner_user_id, name, kind)
        VALUES ($1, 'Personal workspace', 'personal')
        RETURNING id, name, kind, 'owner'::text AS role;
      `,
      [userId],
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      throw new Error('Workspace insert did not return a row');
    }

    await this.databaseService.query(
      `
        INSERT INTO orgs.workspace_members (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
      `,
      [workspace.id, userId],
    );

    return this.toSummary(workspace);
  }

  private toSummary(row: WorkspaceRow): WorkspaceSummary {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      role: row.role,
    };
  }
}
