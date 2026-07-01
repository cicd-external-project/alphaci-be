import { BadRequestException, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type {
  CreateProvisioningJobInput,
  GcpProvisioningJobStatus,
  GcpProvisioningJobType,
  ProvisioningJobSummary,
  SafeProvisioningError,
} from './gcp-control.types';

interface ProvisioningJobRow {
  id: string;
  job_type: GcpProvisioningJobType;
  idempotency_key: string;
  workspace_id: string;
  project_id: string;
  deployment_target_id: string | null;
  status: GcpProvisioningJobStatus;
  attempt_count: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  next_retry_at: string | null;
  dead_letter_reason: string | null;
  safe_error_code: string | null;
  safe_error_message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ProvisioningJobsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async createJob(
    input: CreateProvisioningJobInput,
  ): Promise<ProvisioningJobSummary> {
    this.assertRequiredString(input.idempotencyKey, 'idempotencyKey');
    this.assertRequiredString(input.workspaceId, 'workspaceId');
    this.assertRequiredString(input.projectId, 'projectId');

    const result = await this.databaseService.query<ProvisioningJobRow>(
      `
        INSERT INTO gcp_operations.provisioning_jobs (
          job_type,
          idempotency_key,
          workspace_id,
          project_id,
          deployment_target_id,
          max_attempts,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (idempotency_key)
        DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
        RETURNING *;
      `,
      [
        input.jobType,
        input.idempotencyKey,
        input.workspaceId,
        input.projectId,
        input.deploymentTargetId ?? null,
        input.maxAttempts ?? 5,
        JSON.stringify(input.payload ?? {}),
      ],
    );

    return this.singleRow(result.rows[0], 'provisioning job create');
  }

  async claimNextJob(
    workerId: string,
    jobTypes: GcpProvisioningJobType[],
  ): Promise<ProvisioningJobSummary | null> {
    this.assertRequiredString(workerId, 'workerId');
    if (jobTypes.length === 0) {
      throw new BadRequestException('jobTypes is required');
    }

    const result = await this.databaseService.query<ProvisioningJobRow>(
      `
        UPDATE gcp_operations.provisioning_jobs
        SET
          status = 'running',
          locked_by = $1,
          locked_at = NOW(),
          attempt_count = attempt_count + 1,
          updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM gcp_operations.provisioning_jobs
          WHERE job_type = ANY($2)
            AND status IN ('queued', 'failed')
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *;
      `,
      [workerId, jobTypes],
    );

    const row = result.rows[0];
    return row ? this.toSummary(row) : null;
  }

  async markRetryableFailure(
    id: string,
    error: SafeProvisioningError,
  ): Promise<ProvisioningJobSummary> {
    this.assertRequiredString(id, 'id');
    this.assertRequiredString(error.code, 'error.code');
    this.assertRequiredString(error.safeMessage, 'error.safeMessage');

    const result = await this.databaseService.query<ProvisioningJobRow>(
      `
        UPDATE gcp_operations.provisioning_jobs
        SET
          status = CASE
            WHEN attempt_count >= max_attempts THEN 'dead_letter'
            ELSE 'failed'
          END,
          dead_letter_reason = CASE
            WHEN attempt_count >= max_attempts THEN 'max_attempts_exhausted'
            ELSE NULL
          END,
          safe_error_code = $2,
          safe_error_message = $3,
          next_retry_at = CASE
            WHEN attempt_count >= max_attempts THEN NULL
            ELSE $4::timestamptz
          END,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *;
      `,
      [id, error.code, error.safeMessage, error.nextRetryAt ?? null],
    );

    return this.singleRow(result.rows[0], 'provisioning job retryable failure');
  }

  private assertRequiredString(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${label} is required`);
    }
  }

  private singleRow(
    row: ProvisioningJobRow | undefined,
    operation: string,
  ): ProvisioningJobSummary {
    if (!row) {
      throw new Error(`${operation} returned no row`);
    }

    return this.toSummary(row);
  }

  private toSummary(row: ProvisioningJobRow): ProvisioningJobSummary {
    return {
      id: row.id,
      jobType: row.job_type,
      idempotencyKey: row.idempotency_key,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      deploymentTargetId: row.deployment_target_id,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      lockedAt: row.locked_at,
      lockedBy: row.locked_by,
      nextRetryAt: row.next_retry_at,
      deadLetterReason: row.dead_letter_reason,
      safeErrorCode: row.safe_error_code,
      safeErrorMessage: row.safe_error_message,
      payload: row.payload ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
