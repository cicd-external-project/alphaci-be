import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type {
  EnvEnvironment,
  EnvProvider,
  EnvVarMetadata,
  EnvVarProvisionStatus,
} from './env-provisioning.types';

interface EnvVarMetadataRow {
  id: string;
  project_id: string;
  deployment_target_id: string;
  environment: EnvEnvironment;
  key: string;
  provider: EnvProvider;
  value_stored: false;
  last_provisioned_at: string;
  last_provisioned_by: string;
  status: EnvVarProvisionStatus;
  error_summary: string | null;
  removed_at: string | null;
}

export interface UpsertEnvMetadataBatchInput {
  projectId: string;
  deploymentTargetId: string;
  environment: EnvEnvironment;
  provider: EnvProvider;
  provisionedBy: string;
  entries: Array<{
    key: string;
    status: EnvVarProvisionStatus;
    errorSummary: string | null;
  }>;
}

export interface CountExistingActiveKeysInput {
  deploymentTargetId: string;
  environment: EnvEnvironment;
  keys: string[];
}

@Injectable()
export class EnvVarsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listEnvMetadata(projectId: string): Promise<EnvVarMetadata[]> {
    const result = await this.databaseService.query<EnvVarMetadataRow>(
      `
        SELECT *
        FROM env_provisioning.project_env_var_metadata
        WHERE project_id = $1
          AND removed_at IS NULL
        ORDER BY deployment_target_id, environment, key;
      `,
      [projectId],
    );

    return result.rows.map((row) => this.toMetadata(row));
  }

  async listEnvMetadataForUser(
    projectId: string,
    userId: string,
  ): Promise<EnvVarMetadata[]> {
    const result = await this.databaseService.query<EnvVarMetadataRow>(
      `
        SELECT metadata.*
        FROM env_provisioning.project_env_var_metadata AS metadata
        JOIN projects.provisioned_projects AS project
          ON project.id = metadata.project_id
        WHERE metadata.project_id = $1
          AND project.user_id = $2
          AND metadata.removed_at IS NULL
        ORDER BY metadata.deployment_target_id, metadata.environment, metadata.key;
      `,
      [projectId, userId],
    );

    return result.rows.map((row) => this.toMetadata(row));
  }

  async upsertEnvMetadataBatch(
    input: UpsertEnvMetadataBatchInput,
  ): Promise<void> {
    if (input.entries.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders = input.entries
      .map((entry, index) => {
        const offset = index * 8;
        values.push(
          input.projectId,
          input.deploymentTargetId,
          input.environment,
          entry.key,
          input.provider,
          input.provisionedBy,
          entry.status,
          entry.errorSummary,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, false, NOW(), $${offset + 6}, $${offset + 7}, $${offset + 8})`;
      })
      .join(', ');

    await this.databaseService.query(
      `
        INSERT INTO env_provisioning.project_env_var_metadata (
          project_id,
          deployment_target_id,
          environment,
          key,
          provider,
          value_stored,
          last_provisioned_at,
          last_provisioned_by,
          status,
          error_summary
        )
        VALUES ${placeholders}
        ON CONFLICT (deployment_target_id, environment, key)
        DO UPDATE SET
          provider = EXCLUDED.provider,
          value_stored = false,
          last_provisioned_at = NOW(),
          last_provisioned_by = EXCLUDED.last_provisioned_by,
          status = EXCLUDED.status,
          error_summary = EXCLUDED.error_summary,
          removed_at = NULL,
          updated_at = NOW();
      `,
      values,
    );
  }

  async countExistingActiveKeys(
    input: CountExistingActiveKeysInput,
  ): Promise<number> {
    if (input.keys.length === 0) {
      return 0;
    }

    const result = await this.databaseService.query<{
      existing_count: string | number;
    }>(
      `
        SELECT COUNT(*) AS existing_count
        FROM env_provisioning.project_env_var_metadata
        WHERE deployment_target_id = $1
          AND environment = $2
          AND key = ANY($3::text[])
          AND removed_at IS NULL;
      `,
      [input.deploymentTargetId, input.environment, input.keys],
    );

    return Number(result.rows[0]?.existing_count ?? 0);
  }

  async findEnvMetadataForUser(
    metadataId: string,
    userId: string,
  ): Promise<EnvVarMetadata | null> {
    const result = await this.databaseService.query<EnvVarMetadataRow>(
      `
        SELECT metadata.*
        FROM env_provisioning.project_env_var_metadata AS metadata
        JOIN projects.provisioned_projects AS project
          ON project.id = metadata.project_id
        WHERE metadata.id = $1
          AND project.user_id = $2
          AND metadata.removed_at IS NULL
        LIMIT 1;
      `,
      [metadataId, userId],
    );

    const row = result.rows[0];
    return row ? this.toMetadata(row) : null;
  }

  async markEnvMetadataRemoved(
    metadataId: string,
    userId: string,
    errorSummary: string | null,
  ): Promise<EnvVarMetadata | null> {
    const result = await this.databaseService.query<EnvVarMetadataRow>(
      `
        UPDATE env_provisioning.project_env_var_metadata AS metadata
        SET removed_at = NOW(),
            error_summary = $3,
            updated_at = NOW()
        FROM projects.provisioned_projects AS project
        WHERE project.id = metadata.project_id
          AND metadata.id = $1
          AND project.user_id = $2
        RETURNING metadata.*;
      `,
      [metadataId, userId, errorSummary],
    );

    const row = result.rows[0];
    return row ? this.toMetadata(row) : null;
  }

  private toMetadata(row: EnvVarMetadataRow): EnvVarMetadata {
    return {
      id: row.id,
      projectId: row.project_id,
      deploymentTargetId: row.deployment_target_id,
      environment: row.environment,
      key: row.key,
      provider: row.provider,
      valueStored: row.value_stored,
      lastProvisionedAt: row.last_provisioned_at,
      lastProvisionedBy: row.last_provisioned_by,
      status: row.status,
      errorSummary: row.error_summary,
      removedAt: row.removed_at,
    };
  }
}
