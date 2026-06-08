import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type {
  DeploymentTargetStatus,
  DeploymentTargetSummary,
  EnvOwnershipMode,
  EnvProvider,
  EnvTargetSlot,
} from './env-provisioning.types';

interface DeploymentTargetRow {
  id: string;
  project_id: string;
  slot: EnvTargetSlot;
  ownership_mode: EnvOwnershipMode;
  provider: EnvProvider;
  provider_connection_id: string | null;
  provider_project_id: string;
  provider_project_name: string;
  repo_full_name: string;
  branch_name: string;
  root_directory: string | null;
  build_command: string | null;
  start_command: string | null;
  environment_map: Record<string, unknown>;
  status: DeploymentTargetStatus;
}

export interface CreateDeploymentTargetInput {
  projectId: string;
  slot: EnvTargetSlot;
  ownershipMode: EnvOwnershipMode;
  provider: EnvProvider;
  providerConnectionId?: string | null;
  providerProjectId: string;
  providerProjectName: string;
  repoFullName: string;
  branchName: string;
  rootDirectory?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  environmentMap?: Record<string, unknown>;
}

@Injectable()
export class DeploymentTargetsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async createDeploymentTarget(
    input: CreateDeploymentTargetInput,
  ): Promise<DeploymentTargetSummary> {
    const result = await this.databaseService.query<DeploymentTargetRow>(
      `
        INSERT INTO project_deployment_targets (
          project_id,
          slot,
          ownership_mode,
          provider,
          provider_connection_id,
          provider_project_id,
          provider_project_name,
          repo_full_name,
          branch_name,
          root_directory,
          build_command,
          start_command,
          environment_map
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *;
      `,
      [
        input.projectId,
        input.slot,
        input.ownershipMode,
        input.provider,
        input.providerConnectionId ?? null,
        input.providerProjectId,
        input.providerProjectName,
        input.repoFullName,
        input.branchName,
        input.rootDirectory ?? null,
        input.buildCommand ?? null,
        input.startCommand ?? null,
        JSON.stringify(input.environmentMap ?? {}),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('project_deployment_targets INSERT returned no row');
    }

    return this.toSummary(row);
  }

  async listDeploymentTargets(
    projectId: string,
  ): Promise<DeploymentTargetSummary[]> {
    const result = await this.databaseService.query<DeploymentTargetRow>(
      `
        SELECT *
        FROM project_deployment_targets
        WHERE project_id = $1
        ORDER BY created_at DESC;
      `,
      [projectId],
    );

    return result.rows.map((row) => this.toSummary(row));
  }

  async findDeploymentTargetForUser(
    targetId: string,
    userId: string,
  ): Promise<DeploymentTargetSummary | null> {
    const result = await this.databaseService.query<DeploymentTargetRow>(
      `
        SELECT t.*
        FROM project_deployment_targets t
        JOIN provisioned_projects p ON p.id = t.project_id
        WHERE t.id = $1
          AND p.user_id = $2
        LIMIT 1;
      `,
      [targetId, userId],
    );

    const row = result.rows[0];
    return row ? this.toSummary(row) : null;
  }

  private toSummary(row: DeploymentTargetRow): DeploymentTargetSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      slot: row.slot,
      ownershipMode: row.ownership_mode,
      provider: row.provider,
      providerConnectionId: row.provider_connection_id,
      providerProjectId: row.provider_project_id,
      providerProjectName: row.provider_project_name,
      repoFullName: row.repo_full_name,
      branchName: row.branch_name,
      rootDirectory: row.root_directory,
      buildCommand: row.build_command,
      startCommand: row.start_command,
      environmentMap: row.environment_map ?? {},
      status: row.status,
    };
  }
}
