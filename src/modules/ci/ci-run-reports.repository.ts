import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type { FriendlyMessage } from './translate-results';

export type CiRunStatus = 'success' | 'failure' | 'running' | 'cancelled';

export interface UpsertCiRunReportInput {
  userId: string;
  repoFullName: string;
  branch: string;
  commitSha: string;
  runId: number;
  stage: 'access' | 'quality' | 'package';
  status: CiRunStatus;
  results: Record<string, unknown>;
  friendlyMessages: FriendlyMessage[];
}

export interface CiRunReportRow {
  id: string;
  user_id: string;
  repo_full_name: string;
  branch: string;
  commit_sha: string;
  run_id: string; // bigint comes back as string from pg driver
  stage: 'access' | 'quality' | 'package';
  status: CiRunStatus;
  results: Record<string, unknown>;
  friendly_messages: FriendlyMessage[];
  created_at: string;
  updated_at: string;
}

@Injectable()
export class CiRunReportsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Upsert a CI run report. The unique key is (repo_full_name, run_id, stage).
   * On conflict the status, results, friendly_messages, and updated_at are refreshed.
   */
  async upsert(data: UpsertCiRunReportInput): Promise<void> {
    await this.databaseService.query(
      `
        INSERT INTO workflow.ci_run_reports (
          user_id,
          repo_full_name,
          branch,
          commit_sha,
          run_id,
          stage,
          status,
          results,
          friendly_messages
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (repo_full_name, run_id, stage)
        DO UPDATE SET
          status            = EXCLUDED.status,
          results           = EXCLUDED.results,
          friendly_messages = EXCLUDED.friendly_messages,
          updated_at        = NOW();
      `,
      [
        data.userId,
        data.repoFullName,
        data.branch,
        data.commitSha,
        data.runId,
        data.stage,
        data.status,
        JSON.stringify(data.results),
        JSON.stringify(data.friendlyMessages),
      ],
    );
  }

  /**
   * Fetch the last 150 run-stage rows for a repo, ordered most-recent run first,
   * then stages in a consistent order within each run. The 150 row cap keeps
   * memory bounded (~50 runs × 3 stages).
   */
  async findRecentByRepo(repoFullName: string): Promise<CiRunReportRow[]> {
    const result = await this.databaseService.query<CiRunReportRow>(
      `
        SELECT
          id,
          user_id,
          repo_full_name,
          branch,
          commit_sha,
          run_id::text AS run_id,
          stage,
          status,
          results,
          friendly_messages,
          created_at,
          updated_at
        FROM workflow.ci_run_reports
        WHERE repo_full_name = $1
        ORDER BY run_id DESC, stage ASC
        LIMIT 150;
      `,
      [repoFullName],
    );

    return result.rows;
  }
}
