# Full Platform Dashboard Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cross-phase correctness, security, rollback, and plan-completion gaps found in the full platform dashboard implementation review.

**Architecture:** Keep the dashboard contract local/mock-first except where a task explicitly implements production behavior. Fix high-risk issues first: authorization, quota correctness, feature-flag rollback behavior, and misleading live capability reporting. Then complete the missing Phase 12 behavior and isolate true Phase 13 live activation into adapter contracts that are honest and testable.

**Tech Stack:** NestJS, Supabase/Postgres SQL migrations, Jest, Next.js/React, TypeScript, PowerShell, Git.

---

## Scope And Execution Order

This plan fixes the review findings without broad unrelated refactors. The work should be implemented in this order:

1. Phase 6 security: env metadata ownership enforcement.
2. Phase 11 quota correctness: paid plan detection and env-key delta counting.
3. Phase 12 rollback honesty: feature flags must control endpoints and UI.
4. Phase 12 persistence: workspaces, audit reads/writes, notifications.
5. Phase 4 branch correctness: workflow PR base branch.
6. Phase 1/2 history accuracy: project-specific workflow history.
7. Phase 10 repair UI completeness.
8. Migration rollback coverage.
9. Phase 13 scope correction: either implement true live adapters or explicitly downgrade flags to "deferred" until a separate Phase 13 activation plan.

Do not start Phase 13 live provider implementation until Tasks 1-8 are green.

---

## File Structure

### Backend Files To Modify

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.controller.ts`  
  Add authenticated user extraction for list endpoint.

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`  
  Add owned-list method and env-key quota delta calculation.

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.ts`  
  Add user-scoped list method and count-existing-keys method.

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.spec.ts`  
  Cover user-scoped metadata listing and existing-key count query.

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.spec.ts`  
  Cover unauthorized list prevention and quota delta behavior.

- `cicd-workflow-be/src/modules/usage/usage-quota.service.ts`  
  Recognize real paid plan codes and keep quota checks stable.

- `cicd-workflow-be/src/modules/usage/usage-quota.service.spec.ts`  
  Add paid-plan and quota edge tests.

- `cicd-workflow-be/src/modules/workspaces/*`  
  Replace synthetic controller-only behavior with repository/service/controller boundaries.

- `cicd-workflow-be/src/modules/notifications/*`  
  Replace empty controller-only behavior with repository/service/controller boundaries.

- `cicd-workflow-be/src/modules/audit/*`  
  Add audit module, repository, and service for project action traces.

- `cicd-workflow-be/src/modules/projects/projects.service.ts`  
  Wire project-specific workflow history, workflow PR base branch, audit writes, and audit reads.

- `cicd-workflow-be/src/modules/projects/projects.controller.ts`  
  Keep controller signatures stable; no route removals.

- `cicd-workflow-be/src/modules/projects/projects.module.ts`  
  Import/export audit and collaboration services as needed.

- `cicd-workflow-be/src/modules/capabilities/capabilities.controller.ts`  
  Make live/provider modes honest; do not claim live mode unless live adapter is active.

- `cicd-workflow-be/src/config/app.config.ts`  
  Keep flags, but separate "live requested" from "live adapter active" if true Phase 13 is deferred.

- `cicd-workflow-be/supabase/rollbacks/*.sql`  
  Add rollback files for later dashboard migrations.

### Frontend Files To Modify

- `cicd-workflow-fe/src/hooks/use-capabilities.ts`  
  Include safe fallbacks for `usageQuotas`, `workspaces`, `auditEvents`, and `notifications`.

- `cicd-workflow-fe/src/lib/api/contracts.ts`  
  Add concrete workspace/member/audit/notification response contracts.

- `cicd-workflow-fe/src/lib/api/workspaces.ts`  
  Add workspace member API calls when backend endpoints exist.

- `cicd-workflow-fe/src/lib/api/notifications.ts`  
  Read real notification rows and mark-read results.

- `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`  
  Surface audit state honestly and expose the workflow PR repair action.

- `cicd-workflow-fe/src/app/settings/page.tsx`  
  Add workspace switcher/member management placeholder states only when capability is enabled; add notification center only when enabled.

- `cicd-workflow-fe/tests/unit/api-client.test.ts`  
  Cover new API calls and fallback behavior.

- `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`  
  Update expectations if env metadata list behavior changes.

---

## Task 1: Phase 6 Env Metadata Authorization

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.controller.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.spec.ts`

- [ ] **Step 1: Write failing repository test for user-scoped env metadata list**

Add this test to `env-vars.repository.spec.ts`:

```ts
it('lists env metadata only for projects owned by the user', async () => {
  query.mockResolvedValueOnce({ rows: [] });

  await repository.listEnvMetadataForUser('project-1', 'user-1');

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('JOIN projects.provisioned_projects AS project'),
    ['project-1', 'user-1'],
  );
  const queryText = query.mock.calls[0][0] as string;
  expect(queryText).toContain('metadata.project_id = $1');
  expect(queryText).toContain('project.user_id = $2');
  expect(queryText).toContain('metadata.removed_at IS NULL');
});
```

- [ ] **Step 2: Run repository test and verify it fails**

Run:

```powershell
npm test -- src/modules/env-provisioning/env-vars.repository.spec.ts --runInBand
```

Expected: FAIL because `listEnvMetadataForUser` does not exist.

- [ ] **Step 3: Implement user-scoped repository method**

Add this method in `EnvVarsRepository` below `listEnvMetadata`:

```ts
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
```

- [ ] **Step 4: Add service method and controller ownership extraction**

In `EnvVarsService`, replace the public `listEnvMetadata(projectId: string)` method with:

```ts
async listEnvMetadata(projectId: string, userId: string) {
  return this.envVarsRepository.listEnvMetadataForUser(projectId, userId);
}
```

In `EnvVarsController.list`, change the method to:

```ts
@Get()
list(@Req() req: Request, @Param('projectId') projectId: string) {
  const userId = req.session.user?.id ?? req.session.userId;
  if (!userId) {
    throw new UnauthorizedException('Authentication required');
  }
  return this.service.listEnvMetadata(projectId, userId);
}
```

Also add `UnauthorizedException` to the controller imports.

- [ ] **Step 5: Update internal callers that need trusted local metadata**

In `ProjectsService.getProjectOverview()` and `ProjectDriftService.runDetection()`, do not use the service method. Continue using repository methods only after project ownership has already been checked in the same method. No route should call `EnvVarsRepository.listEnvMetadata(projectId)` directly without an ownership check.

- [ ] **Step 6: Run env vars tests**

Run:

```powershell
npm test -- src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/env-provisioning/env-vars.controller.ts src/modules/env-provisioning/env-vars.service.ts src/modules/env-provisioning/env-vars.repository.ts src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts
git commit -m "fix: scope env metadata reads to project owner"
```

---

## Task 2: Phase 11 Paid Plan And Env-Key Quota Correctness

**Files:**
- Modify: `cicd-workflow-be/src/modules/usage/usage-quota.service.ts`
- Modify: `cicd-workflow-be/src/modules/usage/usage-quota.service.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.spec.ts`

- [ ] **Step 1: Write failing paid-plan test**

Add to `usage-quota.service.spec.ts`:

```ts
it('treats pro_monthly subscriptions as pro quota plan', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ plan_code: 'pro_monthly' }] })
    .mockResolvedValueOnce({
      rows: [
        {
          projects: '4',
          managed_render_services: '2',
          managed_vercel_projects: '2',
          deployment_targets: '6',
          env_keys: '26',
          workflow_prs: '6',
        },
      ],
    });

  await expect(service.getUsage('user-1')).resolves.toMatchObject({
    plan: 'pro',
    items: expect.arrayContaining([
      expect.objectContaining({ code: 'projects', current: 4, limit: 50 }),
    ]),
  });
});
```

- [ ] **Step 2: Implement paid-plan recognition**

In `UsageQuotaService.resolvePlan`, replace the return line with:

```ts
const planCode = result.rows[0]?.plan_code;
return planCode === 'pro' || planCode === 'pro_monthly' ? 'pro' : 'free';
```

- [ ] **Step 3: Write failing repository test for existing env key count**

Add to `env-vars.repository.spec.ts`:

```ts
it('counts existing active env keys for a target and environment', async () => {
  query.mockResolvedValueOnce({ rows: [{ existing_count: '2' }] });

  await expect(
    repository.countExistingActiveKeys({
      deploymentTargetId: 'target-1',
      environment: 'test',
      keys: ['API_URL', 'DATABASE_URL', 'NEW_KEY'],
    }),
  ).resolves.toBe(2);

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('key = ANY($3::text[])'),
    ['target-1', 'test', ['API_URL', 'DATABASE_URL', 'NEW_KEY']],
  );
});
```

- [ ] **Step 4: Implement existing key count**

Add this interface near the repository input interfaces:

```ts
export interface CountExistingActiveKeysInput {
  deploymentTargetId: string;
  environment: EnvEnvironment;
  keys: string[];
}
```

Add this method in `EnvVarsRepository`:

```ts
async countExistingActiveKeys(
  input: CountExistingActiveKeysInput,
): Promise<number> {
  if (input.keys.length === 0) {
    return 0;
  }

  const result = await this.databaseService.query<{ existing_count: string | number }>(
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
```

- [ ] **Step 5: Charge quota only for new env keys**

In `EnvVarsService.provisionEnvVars`, move quota enforcement after `target` is loaded. Replace the current `assertWithinLimit(... dto.vars.length)` block with:

```ts
const target = await this.getOwnedTargetOrThrow(
  projectId,
  dto.deploymentTargetId,
  userId,
);
const existingKeyCount = await this.envVarsRepository.countExistingActiveKeys({
  deploymentTargetId: target.id,
  environment: dto.environment,
  keys: dto.vars.map((variable) => variable.key),
});
const newKeyCount = dto.vars.length - existingKeyCount;
if (newKeyCount > 0) {
  await this.usageQuotaService?.assertWithinLimit(
    userId,
    'env_keys',
    newKeyCount,
  );
}
```

Remove the duplicate `const target = ...` block that used to appear after quota enforcement.

- [ ] **Step 6: Run quota and env tests**

Run:

```powershell
npm test -- src/modules/usage/usage-quota.service.spec.ts src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/usage/usage-quota.service.ts src/modules/usage/usage-quota.service.spec.ts src/modules/env-provisioning/env-vars.repository.ts src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.ts src/modules/env-provisioning/env-vars.service.spec.ts
git commit -m "fix: enforce quotas with real plan and new env keys"
```

---

## Task 3: Phase 12 Feature-Flag Rollback Honesty

**Files:**
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.controller.ts`
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.controller.spec.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.controller.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.controller.spec.ts`
- Modify: `cicd-workflow-fe/src/hooks/use-capabilities.ts`

- [ ] **Step 1: Add backend tests for disabled workspace and notification flags**

In `workspaces.controller.spec.ts`, construct the controller with a config service and add:

```ts
it('returns disabled workspace contract when workspaces are disabled', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ workspaces: { enabled: false } }),
  };
  const controller = new WorkspacesController(configService as never);

  expect(
    controller.getMyWorkspaces({
      session: { userId: 'user-1' },
    } as never),
  ).toEqual({ enabled: false, items: [] });
});
```

In `notifications.controller.spec.ts`, add:

```ts
it('returns disabled notification contract when notifications are disabled', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ notifications: { enabled: false } }),
  };
  const controller = new NotificationsController(configService as never);

  expect(
    controller.list({
      session: { userId: 'user-1' },
    } as never),
  ).toEqual({ enabled: false, items: [], unreadCount: 0 });
});
```

- [ ] **Step 2: Implement config-gated contracts**

Inject `ConfigService` into both controllers. In `WorkspacesController.getMyWorkspaces`, add:

```ts
const config = this.configService.getOrThrow<AppConfig>('app');
if (!config.workspaces.enabled) {
  return { enabled: false, items: [] };
}
```

In `NotificationsController.list`, add:

```ts
const config = this.configService.getOrThrow<AppConfig>('app');
if (!config.notifications.enabled) {
  return { enabled: false, items: [], unreadCount: 0 };
}
```

In `NotificationsController.markRead`, return a disabled result or throw `BadRequestException` when notifications are disabled:

```ts
if (!config.notifications.enabled) {
  throw new BadRequestException('Notifications are disabled');
}
```

- [ ] **Step 3: Fix frontend capability fallback**

In `use-capabilities.ts`, add these fallback fields inside `setCapabilities(...)`:

```ts
usageQuotas: { enabled: false },
workspaces: { enabled: false },
auditEvents: { enabled: false },
notifications: { enabled: false },
```

Also add returned booleans:

```ts
usageQuotasEnabled: capabilities?.usageQuotas?.enabled === true,
workspacesEnabled: capabilities?.workspaces?.enabled === true,
auditEventsEnabled: capabilities?.auditEvents?.enabled === true,
notificationsEnabled: capabilities?.notifications?.enabled === true,
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- src/modules/workspaces/workspaces.controller.spec.ts src/modules/notifications/notifications.controller.spec.ts --runInBand
```

Then in `cicd-workflow-fe` run:

```powershell
npm test -- tests/unit/api-client.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/workspaces src/modules/notifications ../cicd-workflow-fe/src/hooks/use-capabilities.ts ../cicd-workflow-fe/tests/unit/api-client.test.ts
git commit -m "fix: honor collaboration feature flags"
```

---

## Task 4: Phase 12 Workspace, Audit, And Notification Persistence

**Files:**
- Create: `cicd-workflow-be/src/modules/audit/audit.module.ts`
- Create: `cicd-workflow-be/src/modules/audit/audit-events.repository.ts`
- Create: `cicd-workflow-be/src/modules/audit/audit-events.service.ts`
- Create: `cicd-workflow-be/src/modules/audit/audit-events.service.spec.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.module.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`
- Create: `cicd-workflow-be/src/modules/workspaces/workspaces.repository.ts`
- Create: `cicd-workflow-be/src/modules/workspaces/workspaces.service.ts`
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.controller.ts`
- Create: `cicd-workflow-be/src/modules/notifications/notifications.repository.ts`
- Create: `cicd-workflow-be/src/modules/notifications/notifications.service.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.controller.ts`
- Modify: `cicd-workflow-fe/src/lib/api/contracts.ts`
- Modify: `cicd-workflow-fe/src/lib/api/workspaces.ts`
- Modify: `cicd-workflow-fe/src/lib/api/notifications.ts`
- Modify: `cicd-workflow-fe/src/app/settings/page.tsx`

- [ ] **Step 1: Write audit service tests**

Create `audit-events.service.spec.ts`:

```ts
import { AuditEventsService } from './audit-events.service';

describe('AuditEventsService', () => {
  const repository = {
    create: jest.fn(),
    listByProjectForUser: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService.getOrThrow.mockReturnValue({ auditEvents: { enabled: true } });
  });

  it('does not write audit rows when audit is disabled', async () => {
    configService.getOrThrow.mockReturnValueOnce({ auditEvents: { enabled: false } });
    const service = new AuditEventsService(repository as never, configService as never);

    await service.record({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('writes audit rows when audit is enabled', async () => {
    const service = new AuditEventsService(repository as never, configService as never);

    await service.record({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });

    expect(repository.create).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });
  });
});
```

- [ ] **Step 2: Implement audit repository and service**

`audit-events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export interface AuditEventRecord {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  actorUserId: string | null;
  eventCode: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAuditEventInput {
  workspaceId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
  eventCode: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface AuditEventRow {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  actor_user_id: string | null;
  event_code: string;
  message: string;
  metadata_json: Record<string, unknown> | string;
  created_at: string;
}

@Injectable()
export class AuditEventsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(input: CreateAuditEventInput): Promise<AuditEventRecord> {
    const result = await this.databaseService.query<AuditEventRow>(
      `
        INSERT INTO audit.audit_events (
          workspace_id,
          project_id,
          actor_user_id,
          event_code,
          message,
          metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *;
      `,
      [
        input.workspaceId ?? null,
        input.projectId ?? null,
        input.actorUserId ?? null,
        input.eventCode,
        input.message,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return this.toRecord(result.rows[0]);
  }

  async listByProjectForUser(
    projectId: string,
    userId: string,
    limit = 50,
  ): Promise<AuditEventRecord[]> {
    const result = await this.databaseService.query<AuditEventRow>(
      `
        SELECT event.*
        FROM audit.audit_events AS event
        JOIN projects.provisioned_projects AS project
          ON project.id = event.project_id
        WHERE event.project_id = $1
          AND project.user_id = $2
        ORDER BY event.created_at DESC
        LIMIT $3;
      `,
      [projectId, userId, limit],
    );

    return result.rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: AuditEventRow): AuditEventRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      actorUserId: row.actor_user_id,
      eventCode: row.event_code,
      message: row.message,
      metadata:
        typeof row.metadata_json === 'string'
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : row.metadata_json,
      createdAt: row.created_at,
    };
  }
}
```

`audit-events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import {
  AuditEventsRepository,
  type AuditEventRecord,
  type CreateAuditEventInput,
} from './audit-events.repository';

@Injectable()
export class AuditEventsService {
  constructor(
    private readonly repository: AuditEventsRepository,
    private readonly configService: ConfigService,
  ) {}

  async record(input: CreateAuditEventInput): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    await this.repository.create(input);
  }

  async listProjectEvents(
    projectId: string,
    userId: string,
  ): Promise<{ enabled: boolean; items: AuditEventRecord[] }> {
    if (!this.enabled()) {
      return { enabled: false, items: [] };
    }
    return {
      enabled: true,
      items: await this.repository.listByProjectForUser(projectId, userId),
    };
  }

  private enabled(): boolean {
    const config = this.configService.getOrThrow<AppConfig>('app');
    return config.auditEvents?.enabled ?? false;
  }
}
```

`audit.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AuditEventsRepository } from './audit-events.repository';
import { AuditEventsService } from './audit-events.service';

@Module({
  imports: [DatabaseModule],
  providers: [AuditEventsRepository, AuditEventsService],
  exports: [AuditEventsService],
})
export class AuditModule {}
```

- [ ] **Step 3: Wire project audit reads and sensitive action writes**

Import `AuditModule` into `ProjectsModule`.

Inject `AuditEventsService` into `ProjectsService` as optional:

```ts
@Optional()
private readonly auditEventsService?: AuditEventsService,
```

Replace `listProjectAuditEvents` return with:

```ts
return (
  (await this.auditEventsService?.listProjectEvents(projectId, userId)) ?? {
    enabled: this.auditEventsEnabled(),
    items: [],
  }
);
```

After successful workflow PR creation, add:

```ts
await this.auditEventsService?.record({
  actorUserId: userId,
  projectId,
  eventCode: 'workflow_pr_created',
  message: 'Workflow update PR created',
  metadata: {
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.htmlUrl,
    branchName,
    baseBranch,
  },
});
```

Add similar `record()` calls for project creation, CI token rotation, target metadata update/detach, env var provision/delete, sync snapshot creation, drift repair, and quota blocks in the specific service that owns each action. Use event codes:

```ts
'project_created'
'ci_token_rotated'
'deployment_target_updated'
'deployment_target_detached'
'env_vars_provisioned'
'env_var_deleted'
'project_snapshot_synced'
'drift_repair_completed'
'quota_blocked'
```

- [ ] **Step 4: Implement workspace repository/service**

Create a repository that reads `orgs.workspaces` and `orgs.workspace_members` for the current user. If no rows exist, create a personal workspace and owner membership in one transaction-like sequence using the existing `DatabaseService.query` pattern. The service method must return:

```ts
{
  enabled: true,
  items: [
    {
      id: row.id,
      name: row.name,
      kind: row.kind,
      role: row.role,
    },
  ],
}
```

The controller must call the service instead of constructing `personal-${userId}`.

- [ ] **Step 5: Implement notifications repository/service**

Create repository methods:

```ts
listForUser(userId: string): Promise<NotificationsResponse>
markRead(userId: string, id: string): Promise<{ id: string; read: true }>
```

`listForUser` must query `notifications.notifications` for the user and count rows with `read_at IS NULL`. `markRead` must update only rows where `user_id = $2`.

- [ ] **Step 6: Wire frontend workspace and notification UI**

In `settings/page.tsx`, load workspaces only when `workspacesEnabled` is true and show:

- current workspace name
- role
- member-management disabled state if no member endpoint exists yet

Load notifications only when `notificationsEnabled` is true and show:

- unread count
- notification title/body
- mark-read button calling `markNotificationRead`

- [ ] **Step 7: Run focused tests**

Run backend:

```powershell
npm test -- src/modules/audit/audit-events.service.spec.ts src/modules/workspaces/workspaces.controller.spec.ts src/modules/notifications/notifications.controller.spec.ts src/modules/projects/projects.service.spec.ts --runInBand
```

Run frontend:

```powershell
npm test -- tests/unit/api-client.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/audit src/modules/workspaces src/modules/notifications src/modules/projects/projects.module.ts src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts ../cicd-workflow-fe/src/lib/api/contracts.ts ../cicd-workflow-fe/src/lib/api/workspaces.ts ../cicd-workflow-fe/src/lib/api/notifications.ts ../cicd-workflow-fe/src/app/settings/page.tsx ../cicd-workflow-fe/tests/unit/api-client.test.ts
git commit -m "feat: persist workspace audit and notifications"
```

---

## Task 5: Phase 4 Workflow PR Base Branch

**Files:**
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`
- Modify: `cicd-workflow-be/src/modules/github/github.service.ts`
- Modify: `cicd-workflow-be/src/modules/github/github.service.spec.ts`

- [ ] **Step 1: Write failing service test for non-main default branch**

In `projects.service.spec.ts`, add a test near the workflow PR tests:

```ts
it('creates workflow update PRs against the repository default branch', async () => {
  githubService.getRepo.mockResolvedValueOnce({
    fullName: 'tone/orders-api',
    htmlUrl: 'https://github.com/tone/orders-api',
    defaultBranch: 'master',
    private: false,
  });

  const result = await prService.createWorkflowUpdatePullRequest(
    'project-1',
    'user-1',
    'gho_token',
    {},
  );

  expect(githubService.createBranch).toHaveBeenCalledWith(
    'gho_token',
    'tone',
    'orders-api',
    result.branchName,
    'master',
  );
  expect(githubService.createPullRequest).toHaveBeenCalledWith(
    'gho_token',
    'tone',
    'orders-api',
    expect.objectContaining({ base: 'master' }),
  );
});
```

- [ ] **Step 2: Implement default branch resolution**

In `createWorkflowUpdatePullRequest`, after parsing `owner` and `repo`, add:

```ts
const repoInfo = await this.githubService.getRepo(token, owner, repo);
const baseBranch = repoInfo.defaultBranch || 'main';
```

Remove:

```ts
const baseBranch = 'main';
```

- [ ] **Step 3: Run workflow PR tests**

Run:

```powershell
npm test -- src/modules/projects/projects.service.spec.ts src/modules/github/github.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts src/modules/github/github.service.ts src/modules/github/github.service.spec.ts
git commit -m "fix: target workflow update PRs to default branch"
```

---

## Task 6: Phase 1/2 Project-Specific Workflow History

**Files:**
- Modify: `cicd-workflow-be/src/modules/workflows/workflow-history.repository.ts`
- Modify: `cicd-workflow-be/src/modules/workflows/workflow-history.repository.spec.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`

- [ ] **Step 1: Add repository method for project-relevant history**

Add this method:

```ts
async listForProjectIdentity(input: {
  userId: string;
  serviceName: string;
  templateId: string | null;
  limit?: number;
}): Promise<WorkflowHistoryItem[]> {
  const result = await this.databaseService.query<WorkflowHistoryRow>(
    `
      SELECT *
      FROM workflows.workflow_history
      WHERE user_id = $1
        AND (
          service_name = $2
          OR ($3::text IS NOT NULL AND template_id = $3)
        )
      ORDER BY created_at DESC
      LIMIT $4;
    `,
    [input.userId, input.serviceName, input.templateId, input.limit ?? 5],
  );

  return result.rows.map((row) => this.toItem(row));
}
```

- [ ] **Step 2: Replace latest-25 filtering in overview**

In `ProjectsService.getProjectOverview`, replace:

```ts
this.workflowHistoryRepository?.listByUser(userId, 25)
```

and the later in-memory `matchingHistory` filter with:

```ts
this.workflowHistoryRepository?.listForProjectIdentity({
  userId,
  serviceName: row.service_name,
  templateId: row.template_id,
  limit: 5,
}) ?? Promise.resolve([])
```

Then set:

```ts
const matchingHistory = workflowHistory;
```

- [ ] **Step 3: Run project overview tests**

Run:

```powershell
npm test -- src/modules/projects/projects.service.spec.ts src/modules/workflows/workflow-history.repository.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/workflows/workflow-history.repository.ts src/modules/workflows/workflow-history.repository.spec.ts src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "fix: load project-specific workflow history"
```

---

## Task 7: Phase 10 Repair UI Completeness

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`
- Test: `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx` or create `cicd-workflow-fe/tests/unit/workflow-current-tab.test.tsx`

- [ ] **Step 1: Add UI test for workflow PR repair visibility**

Create or extend a test that renders `DriftFindingsPanel` with:

```ts
const response = {
  enabled: true,
  mode: 'local_snapshot',
  findings: [
    {
      id: 'finding-1',
      projectId: 'project-1',
      targetId: null,
      source: 'local_snapshot',
      severity: 'warning',
      code: 'central_workflow_ref_outdated',
      message: 'Central workflow ref is outdated.',
      details: {},
      status: 'active',
      detectedAt: '2026-06-14T00:00:00.000Z',
      resolvedAt: null,
    },
  ],
};
```

Expected: when workflow update PRs are enabled, the panel exposes `Create update PR`; otherwise it exposes `Preview workflow`.

- [ ] **Step 2: Extend `DriftFindingsPanel` props**

Add a prop:

```ts
workflowUpdatePrEnabled: boolean;
```

Change `actionForCode`:

```ts
if (code === 'workflow_files_missing' || code === 'central_workflow_ref_outdated') {
  return workflowUpdatePrEnabled ? 'create_workflow_update_pr' : 'regenerate_workflow_preview';
}
```

Pass `workflowUpdatePrEnabled={workflowUpdatePrEnabled}` at the call site.

- [ ] **Step 3: Run frontend tests**

Run:

```powershell
npm test -- tests/unit/project-env-panel.test.tsx --runInBand
```

If a new test file is created:

```powershell
npm test -- tests/unit/workflow-current-tab.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/components/product/workflow-current-tab.tsx tests/unit/project-env-panel.test.tsx tests/unit/workflow-current-tab.test.tsx
git commit -m "fix: expose workflow PR drift repair"
```

---

## Task 8: Rollback Coverage For Later Dashboard Migrations

**Files:**
- Create: `cicd-workflow-be/supabase/rollbacks/20260612_env_manager_upgrade_down.sql`
- Create: `cicd-workflow-be/supabase/rollbacks/20260613_project_sync_findings_down.sql`
- Create: `cicd-workflow-be/supabase/rollbacks/20260614_usage_quotas_down.sql`
- Create: `cicd-workflow-be/supabase/rollbacks/20260614_workspaces_audit_notifications_down.sql`

- [ ] **Step 1: Create env manager rollback**

`20260612_env_manager_upgrade_down.sql`:

```sql
DROP INDEX IF EXISTS env_provisioning.idx_project_env_var_metadata_active;

ALTER TABLE env_provisioning.project_env_var_metadata
  DROP COLUMN IF EXISTS removed_at;
```

- [ ] **Step 2: Create drift findings rollback**

`20260613_project_sync_findings_down.sql`:

```sql
DROP TABLE IF EXISTS projects.project_sync_findings;
```

- [ ] **Step 3: Create usage rollback**

`20260614_usage_quotas_down.sql`:

```sql
DROP TABLE IF EXISTS usage.usage_events;
DROP TABLE IF EXISTS usage.project_usage_counters;
DROP TABLE IF EXISTS usage.plan_limits;
DROP SCHEMA IF EXISTS usage;
```

- [ ] **Step 4: Create workspace/audit/notification rollback**

`20260614_workspaces_audit_notifications_down.sql`:

```sql
DROP TABLE IF EXISTS notifications.notification_preferences;
DROP TABLE IF EXISTS notifications.notifications;
DROP TABLE IF EXISTS audit.audit_events;

ALTER TABLE projects.provisioned_projects
  DROP COLUMN IF EXISTS workspace_id;

DROP TABLE IF EXISTS orgs.workspace_members;
DROP TABLE IF EXISTS orgs.workspaces;

DROP SCHEMA IF EXISTS notifications;
DROP SCHEMA IF EXISTS audit;
DROP SCHEMA IF EXISTS orgs;
```

- [ ] **Step 5: Validate SQL filenames and content**

Run:

```powershell
Get-ChildItem supabase/rollbacks | Select-Object -ExpandProperty Name
rg -n "DROP TABLE|DROP COLUMN|DROP SCHEMA|DROP INDEX" supabase/rollbacks
```

Expected: rollback files exist for every new migration from `20260611192953` through `20260614`.

- [ ] **Step 6: Commit**

```powershell
git add supabase/rollbacks/20260612_env_manager_upgrade_down.sql supabase/rollbacks/20260613_project_sync_findings_down.sql supabase/rollbacks/20260614_usage_quotas_down.sql supabase/rollbacks/20260614_workspaces_audit_notifications_down.sql
git commit -m "chore: add dashboard migration rollbacks"
```

---

## Task 9: Phase 13 Honesty Gate

**Files:**
- Modify: `cicd-workflow-be/src/modules/capabilities/capabilities.controller.ts`
- Modify: `cicd-workflow-be/src/modules/capabilities/capabilities.controller.spec.ts`
- Modify: `cicd-workflow-be/src/modules/projects/project-ci-runs.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/project-deployments.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/project-drift.service.ts`
- Modify: `cicd-workflow-fe/src/lib/api/contracts.ts`
- Modify: `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`

- [ ] **Step 1: Decide Phase 13 mode before implementation**

Use one of these two options:

Option A, recommended for this fix branch:

```text
Keep Phase 13 deferred. Live flags may be configured, but capabilities must report local modes until real live adapters are implemented.
```

Option B, separate larger implementation:

```text
Implement live GitHub Actions, GitHub project state, Vercel deployments, Render deployments, and live repair adapters in a separate Phase 13 activation branch.
```

For this plan, implement Option A so the current branch becomes honest and shippable.

- [ ] **Step 2: Write failing capabilities test**

Add:

```ts
it('does not report live adapter modes without live adapter implementations', () => {
  configService.getOrThrow.mockReturnValue({
    envProvisioning: { enabled: true },
    projectSyncSnapshots: {
      enabled: true,
      liveGithubEnabled: true,
      liveProvidersEnabled: true,
    },
    ciRunTracking: { enabled: true, liveGithubEnabled: true },
    deploymentHistory: { enabled: true, liveProvidersEnabled: true },
    driftDetection: { enabled: true },
    driftLiveChecks: { enabled: true },
    driftRepair: { enabled: true, liveRepairEnabled: true },
    workflowSettingsPreview: { enabled: true },
    workflowUpdatePr: { enabled: true },
    projectTargetManagement: { enabled: true },
    usageQuotas: { enabled: true },
    workspaces: { enabled: true },
    auditEvents: { enabled: true },
    notifications: { enabled: true },
  });

  expect(controller.getCapabilities()).toMatchObject({
    projectSyncSnapshots: {
      liveGithubEnabled: false,
      liveProvidersEnabled: false,
      mode: 'local_snapshot',
    },
    ciRunTracking: {
      liveGithubEnabled: false,
      mode: 'local_mock',
    },
    deploymentHistory: {
      liveProvidersEnabled: false,
      mode: 'local_mock',
    },
    driftDetection: {
      liveProviderChecksEnabled: false,
      mode: 'local_snapshot',
    },
    driftRepair: {
      liveRepairEnabled: false,
      mode: 'local_safe',
    },
  });
});
```

- [ ] **Step 3: Add explicit local-only constants**

In `CapabilitiesController.getCapabilities`, set:

```ts
const liveAdaptersImplemented = false;
```

Then report:

```ts
liveGithubEnabled: liveAdaptersImplemented && config.projectSyncSnapshots.liveGithubEnabled,
liveProvidersEnabled: liveAdaptersImplemented && config.projectSyncSnapshots.liveProvidersEnabled,
```

Apply the same pattern for CI runs, deployment history, drift detection, and drift repair. Keep the raw config available internally for the later Phase 13 branch, but do not advertise live capability now.

- [ ] **Step 4: Keep service responses consistent**

In `ProjectCiRunsService`, `ProjectDeploymentsService`, and `ProjectDriftService`, keep modes as `local_mock`/`local_snapshot` and keep live booleans false until live providers are injected. This task should not add third-party HTTP calls.

- [ ] **Step 5: Update frontend copy**

In `workflow-current-tab.tsx`, preserve:

```tsx
Live GitHub run sync is not enabled
Live deployment sync is not enabled
Local snapshot
```

Only show live copy when backend contracts expose a non-local mode in a future branch.

- [ ] **Step 6: Run capability and project service tests**

Run:

```powershell
npm test -- src/modules/capabilities/capabilities.controller.spec.ts src/modules/projects/project-ci-runs.service.spec.ts src/modules/projects/project-deployments.service.spec.ts src/modules/projects/project-drift.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/capabilities/capabilities.controller.ts src/modules/capabilities/capabilities.controller.spec.ts src/modules/projects/project-ci-runs.service.ts src/modules/projects/project-deployments.service.ts src/modules/projects/project-drift.service.ts ../cicd-workflow-fe/src/lib/api/contracts.ts ../cicd-workflow-fe/src/components/product/workflow-current-tab.tsx
git commit -m "fix: report dashboard live adapters honestly"
```

---

## Task 10: Full Verification

**Files:**
- No new files.
- Verify both repos.

- [ ] **Step 1: Backend targeted tests**

Run:

```powershell
npm test -- src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts src/modules/usage/usage-quota.service.spec.ts src/modules/workspaces/workspaces.controller.spec.ts src/modules/notifications/notifications.controller.spec.ts src/modules/audit/audit-events.service.spec.ts src/modules/projects/projects.service.spec.ts src/modules/projects/project-ci-runs.service.spec.ts src/modules/projects/project-deployments.service.spec.ts src/modules/projects/project-drift.service.spec.ts src/modules/projects/project-drift-repair.service.spec.ts src/modules/capabilities/capabilities.controller.spec.ts --runInBand
```

Expected: all suites pass.

- [ ] **Step 2: Backend full tests**

Run:

```powershell
npm test -- --runInBand
```

Expected: all suites pass.

- [ ] **Step 3: Backend build**

Run:

```powershell
npm run build
```

Expected: TypeScript build succeeds.

- [ ] **Step 4: Frontend targeted tests**

From `cicd-workflow-fe`, run:

```powershell
npm test -- tests/unit/api-client.test.ts tests/unit/project-env-panel.test.tsx --runInBand
```

Expected: all targeted tests pass.

- [ ] **Step 5: Frontend full tests**

Run:

```powershell
npm test -- --runInBand --coverage=false
```

Expected: all suites pass.

- [ ] **Step 6: Frontend build**

Run:

```powershell
npm run build
```

Expected: Next.js build succeeds.

- [ ] **Step 7: Diff hygiene**

From `C:\Codes\cicd-ex`, run:

```powershell
git -C cicd-workflow-be diff --check
git -C cicd-workflow-fe diff --check
git -C cicd-workflow-be status --short
git -C cicd-workflow-fe status --short
```

Expected: only expected changed files are present; no whitespace errors beyond known CRLF warnings.

- [ ] **Step 8: Final commit**

If all previous task commits were made, no final squashing is required. If implementation happened without per-task commits, commit the final verified change set:

```powershell
git add cicd-workflow-be cicd-workflow-fe
git commit -m "fix: complete dashboard phase review remediation"
```

---

## Self-Review Checklist

- Phase 6 env metadata read is owner-scoped.
- Phase 11 quotas recognize `pro_monthly`.
- Phase 11 env-key quota charges only new active keys.
- Phase 12 endpoints obey feature flags.
- Phase 12 workspace/audit/notification data is persisted or honestly disabled.
- Phase 4 workflow PRs target the repo default branch.
- Phase 1/2 overview uses project-specific workflow history.
- Phase 10 UI exposes workflow PR repair when enabled.
- Later migrations have rollback files.
- Phase 13 capabilities do not claim live activation until real adapters exist.
- Backend targeted tests, backend full tests, backend build, frontend targeted tests, frontend full tests, and frontend build pass.
