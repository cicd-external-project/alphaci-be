import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { DatabaseService } from '../database/database.service';
import type { UsageLimitCode, UsageMeResponse } from './usage.types';

const DEFAULT_LIMITS: Record<'free' | 'pro', Record<UsageLimitCode, number>> = {
  free: {
    projects: 3,
    managed_render_services: 1,
    managed_vercel_projects: 1,
    deployment_targets: 5,
    env_keys: 25,
    workflow_prs: 5,
  },
  pro: {
    projects: 50,
    managed_render_services: 10,
    managed_vercel_projects: 10,
    deployment_targets: 100,
    env_keys: 500,
    workflow_prs: 100,
  },
};

@Injectable()
export class UsageQuotaService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  async getUsage(userId: string): Promise<UsageMeResponse> {
    const enabled = this.enabled();
    const plan = await this.resolvePlan(userId);
    const counts = await this.loadCounts(userId);
    const limits = DEFAULT_LIMITS[plan];

    return {
      enabled,
      plan,
      items: (Object.keys(limits) as UsageLimitCode[]).map((code) => ({
        code,
        current: counts[code] ?? 0,
        limit: limits[code],
        upgradeRequired: (counts[code] ?? 0) >= limits[code],
      })),
    };
  }

  async assertWithinLimit(
    userId: string,
    limitCode: UsageLimitCode,
    increment = 1,
  ): Promise<void> {
    if (!this.enabled()) {
      return;
    }

    const usage = await this.getUsage(userId);
    const item = usage.items.find((candidate) => candidate.code === limitCode);
    if (!item) {
      return;
    }

    if (item.current + increment > item.limit) {
      throw new BadRequestException({
        message: 'Usage quota exceeded',
        limitCode,
        current: item.current,
        limit: item.limit,
        upgradeRequired: usage.plan === 'free',
      });
    }
  }

  private enabled(): boolean {
    const config = this.configService.getOrThrow<AppConfig>('app');
    return config.usageQuotas?.enabled ?? false;
  }

  private async resolvePlan(userId: string): Promise<'free' | 'pro'> {
    const result = await this.databaseService.query<{ plan_code: string }>(
      `
        SELECT plan_code
        FROM billing.user_subscriptions
        WHERE user_id = $1
          AND status = 'active'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 1;
      `,
      [userId],
    );
    const planCode = result.rows[0]?.plan_code;
    return planCode === 'pro' || planCode === 'pro_monthly' ? 'pro' : 'free';
  }

  private async loadCounts(
    userId: string,
  ): Promise<Record<UsageLimitCode, number>> {
    const result = await this.databaseService.query<{
      projects: string | number;
      managed_render_services: string | number;
      managed_vercel_projects: string | number;
      deployment_targets: string | number;
      env_keys: string | number;
      workflow_prs: string | number;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM projects.provisioned_projects WHERE user_id = $1) AS projects,
          (
            SELECT COUNT(*)
            FROM env_provisioning.project_deployment_targets t
            JOIN projects.provisioned_projects p ON p.id = t.project_id
            WHERE p.user_id = $1 AND t.ownership_mode = 'flowci_managed' AND t.provider = 'render'
          ) AS managed_render_services,
          (
            SELECT COUNT(*)
            FROM env_provisioning.project_deployment_targets t
            JOIN projects.provisioned_projects p ON p.id = t.project_id
            WHERE p.user_id = $1 AND t.ownership_mode = 'flowci_managed' AND t.provider = 'vercel'
          ) AS managed_vercel_projects,
          (
            SELECT COUNT(*)
            FROM env_provisioning.project_deployment_targets t
            JOIN projects.provisioned_projects p ON p.id = t.project_id
            WHERE p.user_id = $1
          ) AS deployment_targets,
          (
            SELECT COUNT(*)
            FROM env_provisioning.project_env_var_metadata m
            JOIN projects.provisioned_projects p ON p.id = m.project_id
            WHERE p.user_id = $1 AND m.removed_at IS NULL
          ) AS env_keys,
          (
            SELECT COUNT(*)
            FROM projects.project_workflow_update_requests r
            JOIN projects.provisioned_projects p ON p.id = r.project_id
            WHERE p.user_id = $1
          ) AS workflow_prs;
      `,
      [userId],
    );
    const row = result.rows[0];
    return {
      projects: this.toNumber(row?.projects),
      managed_render_services: this.toNumber(row?.managed_render_services),
      managed_vercel_projects: this.toNumber(row?.managed_vercel_projects),
      deployment_targets: this.toNumber(row?.deployment_targets),
      env_keys: this.toNumber(row?.env_keys),
      workflow_prs: this.toNumber(row?.workflow_prs),
    };
  }

  private toNumber(value: string | number | undefined): number {
    return Number(value ?? 0);
  }
}
