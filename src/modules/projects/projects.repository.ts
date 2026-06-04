import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export interface ProvisionedProjectRow {
  id: string;
  user_id: string;
  repo_full_name: string;
  template_id: string;
  service_name: string;
  workflow_path: string;
  status: 'provisioning' | 'provisioned' | 'failed';
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
  status: 'provisioning' | 'provisioned' | 'failed';
  githubCommitSha?: string | null;
  githubCommitUrl?: string | null;
  failureReason?: string | null;
  repoUrl?: string | null;
  visibility?: string | null;
  repoShape?: string | null;
  projectTypeId?: string | null;
  workflowRecipeId?: string | null;
  projectOptions?: Record<string, unknown> | null;
}

@Injectable()
export class ProjectsRepository {
  private readonly logger = new Logger(ProjectsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(data: CreateProvisionedProjectInput): Promise<ProvisionedProjectRow> {
    const query = `
      INSERT INTO provisioned_projects (
        user_id,
        repo_full_name,
        template_id,
        service_name,
        workflow_path,
        status,
        github_commit_sha,
        github_commit_url,
        failure_reason,
        repo_url,
        visibility,
        repo_shape,
        project_type_id,
        workflow_recipe_id,
        project_options
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const result = await this.databaseService.query<ProvisionedProjectRow>(query, [
      data.userId,
      data.repoFullName,
      data.templateId,
      data.serviceName,
      data.workflowPath,
      data.status,
      data.githubCommitSha ?? null,
      data.githubCommitUrl ?? null,
      data.failureReason ?? null,
      data.repoUrl ?? null,
      data.visibility ?? null,
      data.repoShape ?? null,
      data.projectTypeId ?? null,
      data.workflowRecipeId ?? null,
      data.projectOptions ? JSON.stringify(data.projectOptions) : '{}',
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('provisioned_projects INSERT returned no row');
    }

    return row;
  }

  async listByUser(userId: string, limit = 50): Promise<ProvisionedProjectRow[]> {
    const safeLimit = Math.max(1, Math.min(200, limit));

    const result = await this.databaseService.query<ProvisionedProjectRow>(
      `
        SELECT *
        FROM provisioned_projects
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
      `,
      [userId, safeLimit],
    );

    return result.rows;
  }

  async updateStatus(
    id: string,
    status: 'provisioning' | 'provisioned' | 'failed',
    commitSha?: string | null,
    commitUrl?: string | null,
    failureReason?: string | null,
  ): Promise<void> {
    await this.databaseService.query(
      `
        UPDATE provisioned_projects
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
}
