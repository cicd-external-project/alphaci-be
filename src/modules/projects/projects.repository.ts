import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export type ProvisionedProjectStatus =
  | 'provisioning'
  | 'provisioned'
  | 'failed'
  | 'orphaned';

export interface ProvisionedProjectRow {
  id: string;
  user_id: string;
  repo_full_name: string;
  template_id: string;
  service_name: string;
  workflow_path: string;
  status: ProvisionedProjectStatus;
  github_commit_sha: string | null;
  github_commit_url: string | null;
  failure_reason: string | null;
  repo_url: string | null;
  visibility: string | null;
  repo_shape: string | null;
  project_type_id: string | null;
  workflow_recipe_id: string | null;
  project_options: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProvisionedProjectInput {
  userId: string;
  repoFullName: string;
  templateId: string;
  serviceName: string;
  workflowPath: string;
  status: ProvisionedProjectStatus;
  githubCommitSha?: string | null;
  githubCommitUrl?: string | null;
  failureReason?: string | null;
  repoUrl?: string | null;
  visibility?: string | null;
  repoShape?: string | null;
  projectTypeId?: string | null;
  workflowRecipeId?: string | null;
  projectOptions?: Record<string, unknown> | null;
  workflowSha256?: string | null;
}

@Injectable()
export class ProjectsRepository {
  private readonly logger = new Logger(ProjectsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(
    data: CreateProvisionedProjectInput,
  ): Promise<ProvisionedProjectRow> {
    const query = `
      INSERT INTO projects.provisioned_projects (
        user_id,
        repo_full_name,
        template_id,
        service_name,
        workflow_path,
        workflow_sha256,
        workflow_content_sha,
        status,
        github_commit_sha,
        github_commit_url,
        failure_reason,
        metadata,
        provisioned_at,
        failed_at,
        owner_login,
        repo_name,
        github_repository_url,
        visibility,
        repo_shape,
        project_type_id,
        workflow_recipe_id,
        workflow_template_id,
        project_options
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22
      )
      RETURNING
        id,
        user_id,
        repo_full_name,
        template_id,
        service_name,
        workflow_path,
        status,
        github_commit_sha,
        github_commit_url,
        failure_reason,
        github_repository_url AS repo_url,
        visibility,
        repo_shape,
        project_type_id,
        workflow_recipe_id,
        project_options,
        created_at,
        updated_at;
    `;
    const { ownerLogin, repoName } = this.splitRepoFullName(data.repoFullName);
    const workflowSha256 =
      data.workflowSha256 ?? this.computeWorkflowHash(data);
    const projectOptions = data.projectOptions ?? {};
    const metadata = {
      repoUrl: data.repoUrl ?? null,
      projectOptions,
    };

    const result = await this.databaseService.query<ProvisionedProjectRow>(
      query,
      [
        data.userId,
        data.repoFullName,
        data.templateId,
        data.serviceName,
        data.workflowPath,
        workflowSha256,
        data.githubCommitSha ?? null,
        data.status,
        data.githubCommitSha ?? null,
        data.githubCommitUrl ?? null,
        data.failureReason ?? null,
        JSON.stringify(metadata),
        data.status === 'provisioned' ? new Date().toISOString() : null,
        data.status === 'failed' ? new Date().toISOString() : null,
        ownerLogin,
        repoName,
        data.repoUrl ?? null,
        data.visibility ?? null,
        data.repoShape ?? null,
        data.projectTypeId ?? null,
        data.workflowRecipeId ?? null,
        data.templateId,
        JSON.stringify(projectOptions),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('provisioned_projects INSERT returned no row');
    }

    return row;
  }

  async listByUser(
    userId: string,
    limit = 50,
  ): Promise<ProvisionedProjectRow[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.trunc(limit)))
      : 25;

    const result = await this.databaseService.query<ProvisionedProjectRow>(
      `
        SELECT
          id,
          user_id,
          repo_full_name,
          template_id,
          service_name,
          workflow_path,
          status,
          github_commit_sha,
          github_commit_url,
          failure_reason,
          github_repository_url AS repo_url,
          visibility,
          repo_shape,
          project_type_id,
          workflow_recipe_id,
          project_options,
          created_at,
          updated_at
        FROM projects.provisioned_projects
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
      `,
      [userId, safeLimit],
    );

    return result.rows;
  }

  async findByIdAndUser(
    id: string,
    userId: string,
  ): Promise<ProvisionedProjectRow | null> {
    const result = await this.databaseService.query<ProvisionedProjectRow>(
      `
        SELECT
          id,
          user_id,
          repo_full_name,
          template_id,
          service_name,
          workflow_path,
          status,
          github_commit_sha,
          github_commit_url,
          failure_reason,
          github_repository_url AS repo_url,
          visibility,
          repo_shape,
          project_type_id,
          workflow_recipe_id,
          project_options,
          created_at,
          updated_at
        FROM projects.provisioned_projects
        WHERE id = $1
          AND user_id = $2
        LIMIT 1;
      `,
      [id, userId],
    );

    return result.rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: ProvisionedProjectStatus,
    commitSha?: string | null,
    commitUrl?: string | null,
    failureReason?: string | null,
  ): Promise<void> {
    await this.databaseService.query(
      `
        UPDATE projects.provisioned_projects
        SET
          status             = $2,
          github_commit_sha  = COALESCE($3, github_commit_sha),
          github_commit_url  = COALESCE($4, github_commit_url),
          failure_reason     = COALESCE($5, failure_reason),
          updated_at         = NOW()
        WHERE id = $1;
      `,
      [id, status, commitSha ?? null, commitUrl ?? null, failureReason ?? null],
    );
  }

  /**
   * Hard-delete a provisioned_projects row by its primary key.
   * CASCADE takes care of ci.project_ci_tokens automatically.
   * Scoped to userId to prevent cross-user deletions.
   * Returns true if a row was deleted, false if not found or wrong user.
   */
  async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
    const result = await this.databaseService.query<{ id: string }>(
      `
        DELETE FROM projects.provisioned_projects
        WHERE id = $1 AND user_id = $2
        RETURNING id;
      `,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Set status = 'orphaned' for all project IDs in the given set.
   * Only touches rows owned by userId.
   */
  async markOrphaned(ids: string[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;

    // Build $2, $3, … placeholders for the id list ($1 = userId)
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');

    const result = await this.databaseService.query(
      `
        UPDATE projects.provisioned_projects
        SET status = 'orphaned', updated_at = NOW()
        WHERE user_id = $1
          AND id = ANY(ARRAY[${placeholders}]::uuid[])
          AND status <> 'orphaned';
      `,
      [userId, ...ids],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Reset orphaned status back to provisioned for repos that reappeared
   * or were re-verified. Scoped to userId.
   */
  async markReachable(ids: string[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;

    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');

    const result = await this.databaseService.query(
      `
        UPDATE projects.provisioned_projects
        SET status = 'provisioned', updated_at = NOW()
        WHERE user_id = $1
          AND id = ANY(ARRAY[${placeholders}]::uuid[])
          AND status = 'orphaned';
      `,
      [userId, ...ids],
    );
    return result.rowCount ?? 0;
  }

  private splitRepoFullName(repoFullName: string): {
    ownerLogin: string | null;
    repoName: string | null;
  } {
    const [ownerLogin, repoName] = repoFullName.split('/');
    return {
      ownerLogin: ownerLogin?.trim() || null,
      repoName: repoName?.trim() || null,
    };
  }

  private computeWorkflowHash(data: CreateProvisionedProjectInput): string {
    return createHash('sha256')
      .update(
        [
          data.repoFullName,
          data.templateId,
          data.serviceName,
          data.workflowPath,
          data.githubCommitSha ?? '',
        ].join('\n'),
      )
      .digest('hex');
  }
}
