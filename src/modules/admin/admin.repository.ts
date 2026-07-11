import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type { AdminGcpRuntimeRow } from './gcp-runtime-admin.view';

export interface AdminUserListRow {
  id: string;
  login: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  provider: string;
  created_at: string;
  last_login_at: string | null;
  archived_at: string | null;
  onboarding_completed_at: string | null;
  project_count: number;
  error_count: number;
}

export interface AdminUserProjectRow {
  id: string;
  repo_full_name: string;
  service_name: string | null;
  status: string;
  is_example: boolean;
  created_at: string;
}

export interface AdminUserWorkflowRow {
  id: string;
  template_name: string;
  stack: string;
  service_name: string;
  created_at: string;
}

export interface AdminUserErrorRow {
  id: string;
  repo_full_name: string;
  branch: string;
  run_id: string;
  stage: string;
  status: string;
  friendly_messages: unknown;
  created_at: string;
}

export interface AdminUserSubscriptionRow {
  plan: string;
  plan_code: string;
  status: string;
  current_period_end: string | null;
}

export interface AdminUserActivityRow {
  id: string;
  event_code: string;
  message: string;
  created_at: string;
}

export interface ListUsersOptions {
  search?: string;
  limit: number;
  offset: number;
}

export interface ListGcpRuntimeProjectsOptions {
  status?: string;
  runtimePlacement?: string;
  owner?: string;
  limit?: number;
}

/**
 * Read-only, cross-user data access for the admin views. Every query is fully
 * schema-qualified and NEVER selects secret-bearing columns (provider tokens,
 * encrypted env values, CI token secrets). Secrets are excluded at the source
 * here; the redaction layer in admin-user.view.ts is the second line of defense.
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async countUsers(search?: string): Promise<number> {
    const { clause, params } = this.buildSearchClause(search, 1);
    const result = await this.databaseService.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM identity.app_users AS u ${clause};`,
      params,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listUsers(options: ListUsersOptions): Promise<AdminUserListRow[]> {
    const { clause, params } = this.buildSearchClause(options.search, 1);
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;

    const result = await this.databaseService.query<AdminUserListRow>(
      `
        SELECT
          u.id, u.login, u.display_name, u.email, u.avatar_url, u.provider,
          u.created_at, u.last_login_at, u.archived_at, u.onboarding_completed_at,
          COALESCE(p.project_count, 0)::int AS project_count,
          COALESCE(e.error_count, 0)::int   AS error_count
        FROM identity.app_users AS u
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS project_count
          FROM projects.provisioned_projects
          WHERE is_example = false
          GROUP BY user_id
        ) AS p ON p.user_id = u.id
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS error_count
          FROM workflow.ci_run_reports
          WHERE status = 'failure'
          GROUP BY user_id
        ) AS e ON e.user_id = u.id
        ${clause}
        ORDER BY u.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam};
      `,
      [...params, options.limit, options.offset],
    );
    return result.rows;
  }

  async findUserById(userId: string): Promise<AdminUserListRow | null> {
    const result = await this.databaseService.query<AdminUserListRow>(
      `
        SELECT
          u.id, u.login, u.display_name, u.email, u.avatar_url, u.provider,
          u.created_at, u.last_login_at, u.archived_at, u.onboarding_completed_at,
          (SELECT COUNT(*)::int FROM projects.provisioned_projects
             WHERE user_id = u.id AND is_example = false) AS project_count,
          (SELECT COUNT(*)::int FROM workflow.ci_run_reports
             WHERE user_id = u.id AND status = 'failure') AS error_count
        FROM identity.app_users AS u
        WHERE u.id = $1
        LIMIT 1;
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async listUserProjects(userId: string): Promise<AdminUserProjectRow[]> {
    const result = await this.databaseService.query<AdminUserProjectRow>(
      `
        SELECT id, repo_full_name, service_name, status, is_example, created_at
        FROM projects.provisioned_projects
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100;
      `,
      [userId],
    );
    return result.rows;
  }

  async listUserWorkflows(userId: string): Promise<AdminUserWorkflowRow[]> {
    const result = await this.databaseService.query<AdminUserWorkflowRow>(
      `
        SELECT id, template_name, stack, service_name, created_at
        FROM workflow.workflow_generations
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100;
      `,
      [userId],
    );
    return result.rows;
  }

  async listUserErrors(
    userId: string,
    limit = 100,
  ): Promise<AdminUserErrorRow[]> {
    const result = await this.databaseService.query<AdminUserErrorRow>(
      `
        SELECT id, repo_full_name, branch, run_id::text AS run_id, stage, status,
               friendly_messages, created_at
        FROM workflow.ci_run_reports
        WHERE user_id = $1 AND status = 'failure'
        ORDER BY created_at DESC
        LIMIT $2;
      `,
      [userId, limit],
    );
    return result.rows;
  }

  async findUserSubscription(
    userId: string,
  ): Promise<AdminUserSubscriptionRow | null> {
    const result = await this.databaseService.query<AdminUserSubscriptionRow>(
      `
        SELECT plan, plan_code, status, current_period_end
        FROM billing.user_subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async listUserActivity(
    userId: string,
    limit = 50,
  ): Promise<AdminUserActivityRow[]> {
    const result = await this.databaseService.query<AdminUserActivityRow>(
      `
        SELECT id, event_code, message, created_at
        FROM audit.audit_events
        WHERE actor_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
      `,
      [userId, limit],
    );
    return result.rows;
  }

  async listAdminAccessLog(limit = 100): Promise<AdminUserActivityRow[]> {
    const result = await this.databaseService.query<AdminUserActivityRow>(
      `
        SELECT id, event_code, message, created_at
        FROM audit.audit_events
        WHERE event_code LIKE 'admin.%'
        ORDER BY created_at DESC
        LIMIT $1;
      `,
      [limit],
    );
    return result.rows;
  }

  async listGcpRuntimeProjects(
    options: ListGcpRuntimeProjectsOptions,
  ): Promise<AdminGcpRuntimeRow[]> {
    const params: unknown[] = [];
    const filters: string[] = [];

    if (options.status?.trim()) {
      params.push(options.status.trim());
      const p = `$${params.length}`;
      filters.push(`(
        target.deployment_status = ${p}
        OR target.provisioning_status = ${p}
        OR target.metadata #>> '{reconciliation,status}' = ${p}
      )`);
    }

    if (options.runtimePlacement?.trim()) {
      params.push(options.runtimePlacement.trim());
      filters.push(`target.runtime_scope = $${params.length}`);
    }

    if (options.owner?.trim()) {
      params.push(`%${options.owner.trim()}%`);
      const p = `$${params.length}`;
      filters.push(`(
        owner.login ILIKE ${p}
        OR project.repo_full_name ILIKE ${p}
        OR workspace.name ILIKE ${p}
      )`);
    }

    params.push(options.limit ?? 100);
    const limitParam = `$${params.length}`;
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await this.databaseService.query<AdminGcpRuntimeRow>(
      `
        SELECT
          target.workspace_id::text AS workspace_id,
          workspace.name AS workspace_name,
          target.project_id::text AS project_id,
          project.repo_full_name,
          owner.login AS owner_login,
          target.runtime_scope,
          target.environment,
          target.service_slot,
          target.deployment_status,
          target.provisioning_status,
          target.gcp_project_id,
          target.region,
          target.cloud_run_service_name,
          target.metadata #>> '{reconciliation,status}' AS last_reconciliation_status,
          target.metadata #>> '{reconciliation,lastCheckedAt}' AS last_reconciliation_checked_at,
          target.last_deployment_error_code,
          latest_job.id::text AS last_job_id,
          latest_job.job_type AS last_job_type,
          latest_job.status AS last_job_status,
          latest_job.updated_at::text AS last_job_updated_at,
          latest_job.safe_error_code AS last_job_error_code,
          latest_domain.domain AS domain_hostname,
          latest_domain.domain_kind,
          latest_domain.certificate_status,
          COALESCE(preview_counts.preview_count, 0)::int AS preview_count,
          target.metadata #>> '{entitlements,blockedReason}' AS blocked_entitlement_reason,
          latest_audit.event_code AS last_audit_event_code,
          latest_audit.message AS last_audit_event_message,
          latest_audit.created_at::text AS last_audit_event_created_at
        FROM runtime_deployments.deployment_targets AS target
        JOIN projects.provisioned_projects AS project
          ON project.id = target.project_id
        LEFT JOIN identity.app_users AS owner
          ON owner.id = project.user_id
        LEFT JOIN orgs.workspaces AS workspace
          ON workspace.id = target.workspace_id
        LEFT JOIN LATERAL (
          SELECT job.*
          FROM gcp_operations.provisioning_jobs AS job
          WHERE job.deployment_target_id = target.id
          ORDER BY job.created_at DESC
          LIMIT 1
        ) AS latest_job ON true
        LEFT JOIN LATERAL (
          SELECT domain.*
          FROM runtime_domains.domain_records AS domain
          WHERE domain.deployment_target_id = target.id
            AND domain.is_deprecated = false
          ORDER BY domain.is_primary DESC, domain.updated_at DESC
          LIMIT 1
        ) AS latest_domain ON true
        LEFT JOIN LATERAL (
          SELECT event.*
          FROM audit.audit_events AS event
          WHERE event.project_id = target.project_id
            AND (
              event.event_code LIKE 'gcp.%'
              OR event.event_code = 'legacy_provider_connection.create_blocked'
            )
          ORDER BY event.created_at DESC
          LIMIT 1
        ) AS latest_audit ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS preview_count
          FROM runtime_deployments.deployment_targets AS preview
          WHERE preview.project_id = target.project_id
            AND preview.service_slot = 'preview'
        ) AS preview_counts ON true
        ${whereClause}
        ORDER BY target.updated_at DESC
        LIMIT ${limitParam};
      `,
      params,
    );

    return result.rows;
  }

  /**
   * Builds a parameterized ILIKE search clause over login / display_name / email.
   * startIndex is the first positional parameter to use ($1, $2, ...).
   */
  private buildSearchClause(
    search: string | undefined,
    startIndex: number,
  ): { clause: string; params: unknown[] } {
    const trimmed = search?.trim();
    if (!trimmed) {
      return { clause: '', params: [] };
    }
    const p = `$${startIndex}`;
    return {
      clause: `WHERE (u.login ILIKE ${p} OR u.display_name ILIKE ${p} OR u.email ILIKE ${p})`,
      params: [`%${trimmed}%`],
    };
  }
}
