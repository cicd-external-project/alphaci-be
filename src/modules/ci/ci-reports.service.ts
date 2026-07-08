import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { CiRunReportsRepository } from './ci-run-reports.repository';
import { translateResults } from './translate-results';
import type { CiReportBodyDto } from './dto/ci-report-body.dto';
import type { CiRunStatus } from './ci-run-reports.repository';
import type { FriendlyMessage } from './translate-results';

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface StageReport {
  stage: 'access' | 'quality' | 'package';
  status: 'success' | 'failure' | 'running' | 'cancelled' | 'pending';
  friendlyMessages: FriendlyMessage[];
  githubRunUrl: string;
  updatedAt: string;
  rawLogs: string | null;
}

export interface RunGroup {
  runId: number;
  repoFullName: string;
  branch: string;
  commitSha: string;
  startedAt: string;
  overallStatus: 'success' | 'failure' | 'running' | 'cancelled' | 'partial';
  stages: StageReport[];
}

export interface RunsResponse {
  runs: RunGroup[];
}

// ─── Ownership lookup row ─────────────────────────────────────────────────────

interface OwnershipRow {
  user_id: string;
}

const ALL_STAGES = ['access', 'quality', 'package'] as const;

@Injectable()
export class CiReportsService {
  private readonly logger = new Logger(CiReportsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ciRunReportsRepository: CiRunReportsRepository,
  ) {}

  /**
   * Ingest a CI run report from the generated workflow via ALPHACI_TOKEN auth.
   * Resolves user ownership from the provisioned project, translates results
   * into friendly messages, then upserts the row.
   */
  async ingestReport(body: CiReportBodyDto): Promise<{ received: true }> {
    try {
      const userId = await this.resolveUserIdByRepo(body.repoFullName);
      const status = this.conclusionToStatus(body.conclusion);
      const friendlyMessages = translateResults(
        body.stage,
        body.conclusion,
        body.results,
      );

      await this.ciRunReportsRepository.upsert({
        userId,
        repoFullName: body.repoFullName,
        branch: body.branch,
        commitSha: body.commitSha,
        runId: body.runId,
        stage: body.stage,
        status,
        results: {
          ...(body.results.tests !== undefined && {
            tests: body.results.tests,
          }),
          ...(body.results.coverage !== undefined && {
            coverage: body.results.coverage,
          }),
          ...(body.results.lint !== undefined && { lint: body.results.lint }),
          ...(body.results.security !== undefined && {
            security: body.results.security,
          }),
        },
        friendlyMessages,
        ...(body.rawLogs !== undefined && { rawLogs: body.rawLogs }),
      });
    } catch (err) {
      // Re-throw HTTP exceptions (NotFoundException) so NestJS handles them
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }

      this.logger.error(
        `Failed to ingest CI report for ${body.repoFullName}/${String(body.runId)}/${body.stage}: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }

    return { received: true };
  }

  /**
   * Return grouped runs for the authenticated user.
   *
   * When repoFullName is provided the results are scoped to that repository and
   * ownership is verified. When omitted the user's runs across all their repos
   * are returned (no ownership check needed — the query filters by user_id).
   */
  async getRuns(
    userId: string,
    repoFullName?: string,
    limit?: number,
    offset?: number,
  ): Promise<RunsResponse> {
    if (repoFullName) {
      await this.assertOwnership(userId, repoFullName);
      const rows = await this.ciRunReportsRepository.findRecentByRepo(
        repoFullName,
        limit,
        offset,
      );
      return { runs: this.groupIntoRuns(rows) };
    }

    const rows = await this.ciRunReportsRepository.findRecentByUser(
      userId,
      limit,
      offset,
    );
    return { runs: this.groupIntoRuns(rows) };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async resolveUserIdByRepo(repoFullName: string): Promise<string> {
    const result = await this.databaseService.query<OwnershipRow>(
      `
        SELECT user_id
        FROM projects.provisioned_projects
        WHERE repo_full_name = $1
          AND status = 'provisioned'
        LIMIT 1;
      `,
      [repoFullName],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(
        `No provisioned project found for repository '${repoFullName}'.`,
      );
    }

    return row.user_id;
  }

  private async assertOwnership(
    userId: string,
    repoFullName: string,
  ): Promise<void> {
    const result = await this.databaseService.query<OwnershipRow>(
      `
        SELECT user_id
        FROM projects.provisioned_projects
        WHERE repo_full_name = $1
          AND user_id = $2
        LIMIT 1;
      `,
      [repoFullName, userId],
    );

    if (!result.rows[0]) {
      throw new ForbiddenException(
        `You do not have access to reports for repository '${repoFullName}'.`,
      );
    }
  }

  private conclusionToStatus(
    conclusion: 'success' | 'failure' | 'cancelled',
  ): CiRunStatus {
    switch (conclusion) {
      case 'success':
        return 'success';
      case 'failure':
        return 'failure';
      case 'cancelled':
        return 'cancelled';
    }
  }

  private groupIntoRuns(
    rows: Awaited<ReturnType<CiRunReportsRepository['findRecentByRepo']>>,
  ): RunGroup[] {
    // Preserve run order by tracking first-seen order of run IDs.
    // Each entry also carries its repo so cross-repo results (findRecentByUser)
    // display the correct GitHub Actions URL and RunGroup.repoFullName.
    const runOrder: number[] = [];
    const runMap = new Map<
      number,
      {
        repoFullName: string;
        branch: string;
        commitSha: string;
        startedAt: string;
        stages: Map<string, StageReport>;
      }
    >();

    for (const row of rows) {
      // pg returns bigint as string; parse to number (GitHub run IDs are safe integers)
      const runId = Number(row.run_id);

      if (!runMap.has(runId)) {
        runOrder.push(runId);
        runMap.set(runId, {
          repoFullName: row.repo_full_name,
          branch: row.branch,
          commitSha: row.commit_sha,
          startedAt: row.created_at,
          stages: new Map(),
        });
      }

      const run = runMap.get(runId);
      if (run) {
        run.stages.set(row.stage, {
          stage: row.stage,
          status: row.status,
          friendlyMessages: row.friendly_messages,
          githubRunUrl: `https://github.com/${row.repo_full_name}/actions/runs/${String(runId)}`,
          updatedAt: row.updated_at,
          rawLogs: row.raw_logs,
        });
      }
    }

    return runOrder.map((runId) => {
      const run = runMap.get(runId);
      if (!run) {
        // Should not happen — every runId in runOrder came from runMap
        return {
          runId,
          repoFullName: '',
          branch: '',
          commitSha: '',
          startedAt: '',
          overallStatus: 'partial' as const,
          stages: [],
        };
      }

      const stages: StageReport[] = ALL_STAGES.map((stageName) => {
        return (
          run.stages.get(stageName) ?? {
            stage: stageName,
            status: 'pending' as const,
            friendlyMessages: [],
            githubRunUrl: `https://github.com/${run.repoFullName}/actions/runs/${String(runId)}`,
            updatedAt: '',
            rawLogs: null,
          }
        );
      });

      return {
        runId,
        repoFullName: run.repoFullName,
        branch: run.branch,
        commitSha: run.commitSha,
        startedAt: run.startedAt,
        overallStatus: this.computeOverallStatus(stages),
        stages,
      };
    });
  }

  private computeOverallStatus(
    stages: StageReport[],
  ): RunGroup['overallStatus'] {
    const statuses = stages.map((s) => s.status);
    const present = statuses.filter((s) => s !== 'pending');

    if (present.length < ALL_STAGES.length) {
      return 'partial';
    }

    if (present.every((s) => s === 'success')) {
      return 'success';
    }

    if (present.includes('failure')) {
      return 'failure';
    }

    if (present.includes('running')) {
      return 'running';
    }

    if (present.includes('cancelled')) {
      return 'cancelled';
    }

    return 'partial';
  }
}
