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

@Injectable()
export class EnvVarsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listEnvMetadata(projectId: string): Promise<EnvVarMetadata[]> {
    const result = await this.databaseService.query<EnvVarMetadataRow>(
      `
        SELECT *
        FROM env_provisioning.project_env_var_metadata
        WHERE project_id = $1
        ORDER BY deployment_target_id, environment, key;
      `,
      [projectId],
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
          updated_at = NOW();
      `,
      values,
    );
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
    };
  }
}
