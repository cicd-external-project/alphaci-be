# Full Platform Dashboard Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining dashboard/platform gaps from the June 12 full-platform spec and June 14 review-fixes plan: workspace roles, member management, audit writes, notification generation, Phase 12 UI, quota UX, Workflow Settings parity, and final verification.

**Architecture:** Finish the local/mock-first product foundation before Phase 13 live-provider activation. Backend ownership and event systems become the source of truth; frontend surfaces those contracts through app-shell workspace controls, project audit, notification center, quota warnings, and a complete Workflow Settings editor. Existing single-user projects remain compatible through user-owner fallback while new/updated flows attach to a personal workspace.

**Tech Stack:** NestJS, PostgreSQL/Supabase SQL migrations, Jest, Next.js App Router, React, TypeScript, existing `request()` API helper, existing local/mock project providers.

---

## Current Evidence

- The original spec is `cicd-workflow-be/docs/superpowers/plans/2026-06-12-full-platform-dashboard-spec-plan.md`.
- The review-fixes plan is `cicd-workflow-be/docs/superpowers/plans/2026-06-14-full-platform-dashboard-review-fixes-plan.md`.
- Current backend already has:
  - `GET /api/v1/workspaces/me`
  - `GET /api/v1/notifications`
  - `POST /api/v1/notifications/:id/read`
  - `GET /api/v1/usage/me`
  - project dashboard, sync, workflow settings, CI runs, deployments, drift, repair, audit read endpoints.
- Current frontend already calls workspace, notification, usage, audit, run, deployment, drift, workflow settings APIs.
- Current visible gaps:
  - no workspace switcher
  - project lists are not scoped by selected workspace
  - no member management
  - no workspace-role authorization
  - no last-owner protection for member role changes
  - no separate Audit tab
  - no global notification center
  - no notification preferences UI despite existing preference storage
  - no notification producers
  - audit writes only cover workflow PR creation
  - Workflow Settings UI exposes only a subset of backend settings
  - quota state is not shown before project/env submits
  - billing and provider connection actions are not role-gated in the dashboard
  - Phase 13 live activation remains deferred

---

## File Structure

### Backend Files To Create

- `cicd-workflow-be/supabase/migrations/20260615_workspace_membership_completion.sql`  
  Adds indexes needed for member lookup by login/email and backfills workspace ownership on existing projects.

- `cicd-workflow-be/supabase/rollbacks/20260615_workspace_membership_completion_down.sql`  
  Reverts the completion migration indexes and nullable additions.

- `cicd-workflow-be/src/modules/workspaces/workspace-access.service.ts`  
  Central role and access policy service used by projects and env provisioning.

- `cicd-workflow-be/src/modules/workspaces/workspace-access.service.spec.ts`  
  Unit tests for owner/admin/developer/viewer permissions and old user-owned fallback.

- `cicd-workflow-be/src/modules/notifications/notification-events.service.ts`  
  Event producer service for in-app notifications.

- `cicd-workflow-be/src/modules/notifications/notification-events.service.spec.ts`  
  Tests for notification creation and feature-flag disable behavior.

### Backend Files To Modify

- `cicd-workflow-be/src/modules/workspaces/workspaces.repository.ts`  
  Add member list, add by GitHub login/email, role update, removal, project access, and default workspace helpers.

- `cicd-workflow-be/src/modules/workspaces/workspaces.service.ts`  
  Add member management methods and delegate role checks to `WorkspaceAccessService`.

- `cicd-workflow-be/src/modules/workspaces/workspaces.controller.ts`  
  Add member-management endpoints.

- `cicd-workflow-be/src/modules/workspaces/workspaces.module.ts`  
  Export `WorkspacesService` and `WorkspaceAccessService`.

- `cicd-workflow-be/src/modules/projects/projects.repository.ts`  
  Attach new projects to a workspace, load projects through workspace membership, filter project lists by selected workspace, and keep legacy user ownership fallback.

- `cicd-workflow-be/src/modules/projects/projects.service.ts`  
  Use workspace authorization for reads/mutations, enforce billing/provider role policies where those flows live, and write audit/notification events for project actions.

- `cicd-workflow-be/src/modules/projects/projects.module.ts`  
  Import `WorkspacesModule` for role checks and `NotificationsModule` for project event notifications.

- `cicd-workflow-be/src/modules/env-provisioning/env-provisioning.module.ts`  
  Import `WorkspacesModule` for role checks, `AuditModule` for env/target audit writes, and `NotificationsModule` for env/target notifications.

- `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`  
  Enforce workspace roles and record audit/notification events for target actions.

- `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`  
  Enforce workspace roles and record audit/notification events for env var actions.

- `cicd-workflow-be/src/modules/notifications/notifications.repository.ts`  
  Add `createForUser()` and optional workspace/project fields in returned rows.

- `cicd-workflow-be/src/modules/notifications/notifications.module.ts`  
  Export notification event service.

- `cicd-workflow-be/src/modules/audit/audit-events.repository.ts`  
  Keep existing read/write contract and preserve project-scoped ordering.

- `cicd-workflow-be/src/modules/audit/audit-events.service.ts`  
  Add a no-throw `recordProjectEvent()` helper for repeated callers.

- `cicd-workflow-be/src/modules/usage/usage-quota.service.ts`  
  Preserve current quota checks and add quota-block audit/notification calls through explicit caller hooks, not direct circular dependencies.

- `cicd-workflow-be/src/modules/usage/usage.controller.ts`  
  Ensure workspace billing/usage management endpoints require owner/admin when mutations or plan actions are added.

- `cicd-workflow-be/src/modules/provider-connections/provider-connections.service.ts`  
  Require owner/admin for connecting, disconnecting, or rotating provider credentials if this module exists in the checkout.

### Frontend Files To Create

- `cicd-workflow-fe/src/components/layout/workspace-switcher.tsx`  
  App-shell workspace switcher with current workspace, role, persisted selected workspace id, and disabled state when only one workspace exists.

- `cicd-workflow-fe/src/components/layout/notification-center.tsx`  
  Global notification center popover showing unread count, read state, and mark-read action.

- `cicd-workflow-fe/src/components/layout/workspace-context.tsx`  
  Client context for selected workspace id so project queries and settings panels use the same selection.

- `cicd-workflow-fe/src/components/settings/workspace-members-section.tsx`  
  Member management UI for list/add/update/remove.

- `cicd-workflow-fe/src/components/settings/notification-preferences-section.tsx`  
  Notification preference toggles for in-app notifications and a disabled email toggle while email delivery remains out of scope.

- `cicd-workflow-fe/tests/unit/workspace-members-section.test.tsx`  
  Tests member-management role and error behavior.

- `cicd-workflow-fe/tests/unit/workspace-switcher.test.tsx`  
  Tests personal workspace and multi-workspace rendering.

- `cicd-workflow-fe/tests/unit/notification-center.test.tsx`  
  Tests unread/read states and mark-read action.

### Frontend Files To Modify

- `cicd-workflow-fe/src/lib/api/contracts.ts`  
  Add workspace member, member mutation, notification creation/read contracts, full Workflow Settings form fields, and quota error shape.

- `cicd-workflow-fe/src/lib/api/workspaces.ts`  
  Add member API calls and selected workspace helpers.

- `cicd-workflow-fe/src/lib/api/notifications.ts`  
  Keep list/mark-read; add notification preference read/update calls; ensure return contracts match backend.

- `cicd-workflow-fe/src/lib/api/projects.ts`  
  Add optional `workspaceId` query support; ensure Workflow Settings payload includes all editable fields.

- `cicd-workflow-fe/src/components/layout/app-nav.tsx`  
  Add `WorkspaceSwitcher` and `NotificationCenter` to authenticated shell.

- `cicd-workflow-fe/src/app/settings/page.tsx`  
  Replace disabled member placeholder with `WorkspaceMembersSection` and add notification preferences.

- `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`  
  Add `Audit` tab, complete Workflow Settings UI, quota/status messaging, and role-aware disabled controls.

- `cicd-workflow-fe/src/components/product/workflow-setup-tab.tsx`  
  Add quota panel before project creation submit and selected workspace handoff.

- `cicd-workflow-fe/src/components/product/project-env-panel.tsx`  
  Add quota panel before env provision submit and role-aware disabled states.

- `cicd-workflow-fe/tests/unit/api-client.test.ts`  
  Cover new workspace member APIs and complete Workflow Settings payload.

- `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`  
  Cover quota warning and role-disabled env actions.

---

## Task 1: Workspace Completion Migration

**Files:**
- Create: `cicd-workflow-be/supabase/migrations/20260615_workspace_membership_completion.sql`
- Create: `cicd-workflow-be/supabase/rollbacks/20260615_workspace_membership_completion_down.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260615_workspace_membership_completion.sql`:

```sql
-- Complete workspace membership support for dashboard Phase 12.
-- Keeps projects.workspace_id nullable so legacy user-owned projects continue to work.

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON orgs.workspace_members(workspace_id, role);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user
  ON orgs.workspaces(owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_personal_owner
  ON orgs.workspaces(owner_user_id)
  WHERE kind = 'personal' AND owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_login_lower
  ON identity.app_users (lower(login));

CREATE INDEX IF NOT EXISTS idx_app_users_email_lower
  ON identity.app_users (lower(email))
  WHERE email IS NOT NULL;

-- Backfill personal workspaces for projects that do not yet point at a workspace.
WITH project_owners AS (
  SELECT DISTINCT user_id::uuid AS user_id
  FROM projects.provisioned_projects
  WHERE workspace_id IS NULL
),
inserted_workspaces AS (
  INSERT INTO orgs.workspaces (owner_user_id, name, kind)
  SELECT user_id, 'Personal workspace', 'personal'
  FROM project_owners
  ON CONFLICT (owner_user_id) WHERE kind = 'personal' DO NOTHING
  RETURNING id, owner_user_id
),
all_owner_workspaces AS (
  SELECT id, owner_user_id
  FROM inserted_workspaces
  UNION
  SELECT DISTINCT ON (owner_user_id) id, owner_user_id
  FROM orgs.workspaces
  WHERE kind = 'personal'
  ORDER BY owner_user_id, created_at ASC
)
INSERT INTO orgs.workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner'
FROM all_owner_workspaces
ON CONFLICT (workspace_id, user_id) DO NOTHING;

UPDATE projects.provisioned_projects AS project
SET workspace_id = workspace.id
FROM (
  SELECT DISTINCT ON (owner_user_id) id, owner_user_id
  FROM orgs.workspaces
  WHERE kind = 'personal'
  ORDER BY owner_user_id, created_at ASC
) AS workspace
WHERE project.workspace_id IS NULL
  AND project.user_id::uuid = workspace.owner_user_id;
```

- [ ] **Step 2: Write the rollback**

Create `supabase/rollbacks/20260615_workspace_membership_completion_down.sql`:

```sql
DROP INDEX IF EXISTS identity.idx_app_users_email_lower;
DROP INDEX IF EXISTS identity.idx_app_users_login_lower;
DROP INDEX IF EXISTS orgs.uq_workspaces_personal_owner;
DROP INDEX IF EXISTS orgs.idx_workspaces_owner_user;
DROP INDEX IF EXISTS orgs.idx_workspace_members_workspace;
```

- [ ] **Step 3: Verify SQL files are present**

Run:

```powershell
Get-ChildItem supabase/migrations/20260615_workspace_membership_completion.sql
Get-ChildItem supabase/rollbacks/20260615_workspace_membership_completion_down.sql
```

Expected: both commands print the file path.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20260615_workspace_membership_completion.sql supabase/rollbacks/20260615_workspace_membership_completion_down.sql
git commit -m "feat: complete workspace membership migration"
```

---

## Task 2: Workspace Member APIs And Role Policy

**Files:**
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.repository.ts`
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.service.ts`
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.controller.ts`
- Modify: `cicd-workflow-be/src/modules/workspaces/workspaces.module.ts`
- Create: `cicd-workflow-be/src/modules/workspaces/workspace-access.service.ts`
- Test: `cicd-workflow-be/src/modules/workspaces/workspaces.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/workspaces/workspaces.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/workspaces/workspaces.controller.spec.ts`
- Test: `cicd-workflow-be/src/modules/workspaces/workspace-access.service.spec.ts`

- [ ] **Step 1: Add repository tests for member management**

Add tests to `workspaces.repository.spec.ts` for:

```ts
it('lists workspace members with user profile fields', async () => {
  query.mockResolvedValueOnce({
    rows: [
      {
        id: 'member-1',
        workspace_id: 'workspace-1',
        user_id: 'user-1',
        role: 'owner',
        created_at: new Date('2026-06-15T00:00:00.000Z'),
        login: 'tone',
        display_name: 'Tone',
        email: 'tone@example.test',
        avatar_url: null,
      },
    ],
  });

  await expect(repository.listMembers('workspace-1')).resolves.toEqual([
    {
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      login: 'tone',
      name: 'Tone',
      email: 'tone@example.test',
      avatarUrl: null,
      createdAt: '2026-06-15T00:00:00.000Z',
    },
  ]);
});

it('adds a registered user by login', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ id: 'user-2' }] })
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'member-2',
          workspace_id: 'workspace-1',
          user_id: 'user-2',
          role: 'developer',
          created_at: new Date('2026-06-15T00:00:00.000Z'),
          login: 'dev',
          display_name: 'Dev User',
          email: null,
          avatar_url: null,
        },
      ],
    });

  await expect(
    repository.addMemberByLoginOrEmail('workspace-1', 'dev', 'developer'),
  ).resolves.toMatchObject({
    workspaceId: 'workspace-1',
    userId: 'user-2',
    role: 'developer',
    login: 'dev',
  });
});
```

- [ ] **Step 2: Implement repository member methods**

Add these exports and methods to `workspaces.repository.ts`:

```ts
export type WorkspaceRole = 'owner' | 'admin' | 'developer' | 'viewer';

export interface WorkspaceMemberSummary {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  login: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}
```

```ts
async listMembers(workspaceId: string): Promise<WorkspaceMemberSummary[]> {
  const result = await this.databaseService.query<WorkspaceMemberRow>(
    `
      SELECT
        member.id,
        member.workspace_id,
        member.user_id,
        member.role,
        member.created_at,
        user_profile.login,
        user_profile.display_name,
        user_profile.email,
        user_profile.avatar_url
      FROM orgs.workspace_members AS member
      JOIN identity.app_users AS user_profile
        ON user_profile.id = member.user_id
      WHERE member.workspace_id = $1
      ORDER BY
        CASE member.role
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'developer' THEN 3
          ELSE 4
        END,
        lower(user_profile.login) ASC;
    `,
    [workspaceId],
  );

  return result.rows.map((row) => this.toMemberSummary(row));
}

async findMembership(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership | null> {
  const result = await this.databaseService.query<{
    workspace_id: string;
    user_id: string;
    role: WorkspaceRole;
  }>(
    `
      SELECT workspace_id, user_id, role
      FROM orgs.workspace_members
      WHERE workspace_id = $1
        AND user_id = $2;
    `,
    [workspaceId, userId],
  );

  const row = result.rows[0];
  return row
    ? { workspaceId: row.workspace_id, userId: row.user_id, role: row.role }
    : null;
}

async findProjectMembership(
  projectId: string,
  userId: string,
): Promise<WorkspaceMembership | null> {
  const result = await this.databaseService.query<{
    workspace_id: string;
    user_id: string;
    role: WorkspaceRole;
  }>(
    `
      SELECT member.workspace_id, member.user_id, member.role
      FROM projects.provisioned_projects AS project
      JOIN orgs.workspace_members AS member
        ON member.workspace_id = project.workspace_id
      WHERE project.id = $1
        AND member.user_id = $2;
    `,
    [projectId, userId],
  );

  const row = result.rows[0];
  return row
    ? { workspaceId: row.workspace_id, userId: row.user_id, role: row.role }
    : null;
}
```

Implement `addMemberByLoginOrEmail`, `updateMemberRole`, and `removeMember` with these SQL shapes.

Add `countOwners(workspaceId)` for last-owner validation:

```sql
SELECT count(*)::int AS count
FROM orgs.workspace_members
WHERE workspace_id = $1
  AND role = 'owner';
```

User lookup:

```sql
SELECT id
FROM identity.app_users
WHERE lower(login) = lower($1)
   OR lower(email) = lower($1)
LIMIT 1;
```

Member add/update by login or email:

```sql
INSERT INTO orgs.workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, user_id)
DO UPDATE SET role = EXCLUDED.role
RETURNING id, workspace_id, user_id, role, created_at;
```

Role update by membership id:

```sql
UPDATE orgs.workspace_members
SET role = $3
WHERE workspace_id = $1
  AND id = $2
  AND (
    role <> 'owner'
    OR $3 = 'owner'
    OR (
      SELECT count(*)
      FROM orgs.workspace_members AS owner_member
      WHERE owner_member.workspace_id = $1
        AND owner_member.role = 'owner'
    ) > 1
  )
RETURNING id, workspace_id, user_id, role, created_at;
```

Member removal:

```sql
DELETE FROM orgs.workspace_members
WHERE workspace_id = $1
  AND id = $2
  AND (
    role <> 'owner'
    OR (
      SELECT count(*)
      FROM orgs.workspace_members AS owner_member
      WHERE owner_member.workspace_id = $1
        AND owner_member.role = 'owner'
    ) > 1
  )
RETURNING id;
```

If the role update or removal returns no row, the service must distinguish:

- target member does not exist: `NotFoundException`
- target is the last owner: `BadRequestException('Workspace must keep at least one owner')`
- caller lacks permission: `ForbiddenException`

- [ ] **Step 3: Add workspace access service tests**

Create `workspace-access.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspaceAccessService } from './workspace-access.service';

describe('WorkspaceAccessService', () => {
  const repository = {
    findMembership: jest.fn(),
    findProjectMembership: jest.fn(),
  };

  let service: WorkspaceAccessService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new WorkspaceAccessService(repository as never);
  });

  it('allows owners to manage members', async () => {
    repository.findMembership.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
    });

    await expect(
      service.assertWorkspaceRole('workspace-1', 'user-1', ['owner', 'admin']),
    ).resolves.toEqual({ workspaceId: 'workspace-1', userId: 'user-1', role: 'owner' });
  });

  it('blocks developers from managing members', async () => {
    repository.findMembership.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'developer',
    });

    await expect(
      service.assertWorkspaceRole('workspace-1', 'user-1', ['owner', 'admin']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws not found when the user is not a workspace member', async () => {
    repository.findMembership.mockResolvedValue(null);

    await expect(
      service.assertWorkspaceRole('workspace-1', 'user-1', ['viewer']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks demoting the last owner through service validation', async () => {
    repository.findMembership.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      role: 'owner',
    });
    repository.countOwners.mockResolvedValue(1);

    await expect(
      service.assertCanChangeOwnerRole('workspace-1', 'owner-1', 'admin'),
    ).rejects.toThrow('Workspace must keep at least one owner');
  });
});
```

- [ ] **Step 4: Implement `WorkspaceAccessService`**

Create `workspace-access.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import {
  WorkspacesRepository,
  type WorkspaceMembership,
  type WorkspaceRole,
} from './workspaces.repository';

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly repository: WorkspacesRepository) {}

  async assertWorkspaceRole(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRole[],
  ): Promise<WorkspaceMembership> {
    const membership = await this.repository.findMembership(workspaceId, userId);
    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }
    this.assertRole(membership.role, allowedRoles);
    return membership;
  }

  async assertProjectRole(
    projectId: string,
    userId: string,
    allowedRoles: WorkspaceRole[],
  ): Promise<WorkspaceMembership | null> {
    const membership = await this.repository.findProjectMembership(projectId, userId);
    if (!membership) {
      return null;
    }
    this.assertRole(membership.role, allowedRoles);
    return membership;
  }

  async assertCanChangeOwnerRole(
    workspaceId: string,
    targetUserId: string,
    nextRole: WorkspaceRole,
  ): Promise<void> {
    if (nextRole === 'owner') return;
    const targetMembership = await this.repository.findMembership(workspaceId, targetUserId);
    if (targetMembership?.role !== 'owner') return;
    const ownerCount = await this.repository.countOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new BadRequestException('Workspace must keep at least one owner');
    }
  }

  private assertRole(role: WorkspaceRole, allowedRoles: WorkspaceRole[]): void {
    const minimumRank = Math.min(...allowedRoles.map((allowed) => ROLE_RANK[allowed]));
    if (ROLE_RANK[role] < minimumRank) {
      throw new ForbiddenException('Insufficient workspace role');
    }
  }
}
```

Import `BadRequestException` alongside the existing Nest exceptions.

- [ ] **Step 5: Add controller tests for member endpoints**

Add tests in `workspaces.controller.spec.ts` for:

```ts
it('lists members for a workspace owner', async () => {
  service.listMembers.mockResolvedValue([{ id: 'member-1', role: 'owner' }]);

  await expect(controller.listMembers(makeRequest(), 'workspace-1')).resolves.toEqual([
    { id: 'member-1', role: 'owner' },
  ]);
  expect(service.listMembers).toHaveBeenCalledWith('workspace-1', 'user-1');
});

it('adds a workspace member by login', async () => {
  service.addMember.mockResolvedValue({ id: 'member-2', role: 'developer' });

  await expect(
    controller.addMember(makeRequest(), 'workspace-1', {
      loginOrEmail: 'dev',
      role: 'developer',
    }),
  ).resolves.toEqual({ id: 'member-2', role: 'developer' });
});

it('blocks demoting the final workspace owner', async () => {
  service.updateMemberRole.mockRejectedValue(
    new BadRequestException('Workspace must keep at least one owner'),
  );

  await expect(
    controller.updateMemberRole(makeRequest(), 'workspace-1', 'member-owner', {
      role: 'admin',
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
});
```

- [ ] **Step 6: Implement controller endpoints**

Add endpoints to `workspaces.controller.ts`:

```ts
@Get(':workspaceId/members')
listMembers(@Req() req: Request, @Param('workspaceId') workspaceId: string) {
  const userId = this.requireUserId(req);
  return this.workspacesService.listMembers(workspaceId, userId);
}

@Post(':workspaceId/members')
addMember(
  @Req() req: Request,
  @Param('workspaceId') workspaceId: string,
  @Body() body: { loginOrEmail: string; role: WorkspaceRole },
) {
  const userId = this.requireUserId(req);
  return this.workspacesService.addMember(workspaceId, userId, body);
}

@Patch(':workspaceId/members/:memberId')
updateMemberRole(
  @Req() req: Request,
  @Param('workspaceId') workspaceId: string,
  @Param('memberId') memberId: string,
  @Body() body: { role: WorkspaceRole },
) {
  const userId = this.requireUserId(req);
  return this.workspacesService.updateMemberRole(workspaceId, userId, memberId, body.role);
}

@Delete(':workspaceId/members/:memberId')
removeMember(
  @Req() req: Request,
  @Param('workspaceId') workspaceId: string,
  @Param('memberId') memberId: string,
) {
  const userId = this.requireUserId(req);
  return this.workspacesService.removeMember(workspaceId, userId, memberId);
}
```

- [ ] **Step 7: Run workspace tests**

Run:

```powershell
npm test -- src/modules/workspaces/workspaces.repository.spec.ts src/modules/workspaces/workspaces.service.spec.ts src/modules/workspaces/workspaces.controller.spec.ts src/modules/workspaces/workspace-access.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/workspaces
git commit -m "feat: add workspace member management"
```

---

## Task 3: Workspace Authorization Across Projects And Env Provisioning

**Files:**
- Modify: `cicd-workflow-be/src/modules/projects/projects.repository.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.module.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-provisioning.module.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.repository.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`
- Modify: `cicd-workflow-be/src/modules/usage/usage.controller.ts`
- Modify: `cicd-workflow-be/src/modules/provider-connections/provider-connections.service.ts` if present
- Test: `cicd-workflow-be/src/modules/projects/projects.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/env-vars.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/usage/usage.controller.spec.ts`
- Test: `cicd-workflow-be/src/modules/provider-connections/provider-connections.service.spec.ts` if present

- [ ] **Step 1: Add project repository tests for workspace access**

In `projects.repository.spec.ts`, add:

```ts
it('finds a project through workspace membership', async () => {
  query.mockResolvedValueOnce({ rows: [projectRow] });

  await repository.findByIdForUser('project-1', 'user-2');

  expect(query.mock.calls[0][0]).toContain('orgs.workspace_members');
  expect(query.mock.calls[0][0]).toContain('project.user_id = $2');
});
```

The SQL must allow:

```sql
project.user_id = $2
OR EXISTS (
  SELECT 1
  FROM orgs.workspace_members AS member
  WHERE member.workspace_id = project.workspace_id
    AND member.user_id = $2
)
```

- [ ] **Step 2: Update project read SQL**

Update `findByIdForUser`, list methods, overview reads, and disconnect reads to use the workspace-member fallback SQL above.

For project list methods, accept an optional `workspaceId` argument and add this filter only when the caller provides it:

```sql
AND project.workspace_id = $workspaceId
```

The list query must still require either legacy ownership or membership in that exact workspace:

```sql
AND (
  project.user_id = $userId
  OR EXISTS (
    SELECT 1
    FROM orgs.workspace_members AS member
    WHERE member.workspace_id = project.workspace_id
      AND member.user_id = $userId
  )
)
```

If `workspaceId` is supplied and the user is not a workspace member, return an empty list for list endpoints and `ForbiddenException` for mutations.

- [ ] **Step 3: Attach created projects to the user default workspace**

In `ProjectsService.createProject` and setup paths, before saving a project, load the user default workspace through `WorkspacesService.getMyWorkspaces(userId)`. Use the first returned item as `workspaceId` in repository create input.

Expected behavior:

```ts
const workspaces = await this.workspacesService?.getMyWorkspaces(userId);
const workspaceId = workspaces?.items[0]?.id ?? null;
```

Existing projects with `workspace_id = null` remain readable through `user_id`.

- [ ] **Step 4: Add env repository tests for workspace access**

In `deployment-targets.repository.spec.ts` and `env-vars.repository.spec.ts`, assert owner checks include workspace membership:

```ts
expect(queryText).toContain('orgs.workspace_members');
expect(queryText).toContain('project.workspace_id');
```

- [ ] **Step 5: Update env repository owner checks**

Replace strict `project.user_id = $n` checks with:

```sql
(
  project.user_id = $n
  OR EXISTS (
    SELECT 1
    FROM orgs.workspace_members AS member
    WHERE member.workspace_id = project.workspace_id
      AND member.user_id = $n
      AND member.role IN ('owner', 'admin', 'developer')
  )
)
```

For read-only list endpoints, include `viewer` in the allowed role set.

- [ ] **Step 6: Add service tests for viewer mutation blocks**

Add tests that mock workspace access as viewer and assert mutations throw `ForbiddenException` for:

- deployment target update
- deployment target detach
- env var provision
- env var delete

- [ ] **Step 7: Add billing and provider role tests**

Add tests for these role boundaries:

- owner/admin can manage billing actions and provider connections
- developer can create/update project workflow and env resources but cannot manage billing
- viewer cannot mutate project, env, billing, or provider connection resources

Where the existing checkout has no provider-connections module, record that in the implementation log and keep this item scoped to billing/usage controller tests.

- [ ] **Step 8: Inject and enforce `WorkspaceAccessService`**

For mutation methods, call:

```ts
await this.workspaceAccessService.assertProjectRole(projectId, userId, [
  'owner',
  'admin',
  'developer',
]);
```

For read methods, call:

```ts
await this.workspaceAccessService.assertProjectRole(projectId, userId, [
  'owner',
  'admin',
  'developer',
  'viewer',
]);
```

If `assertProjectRole` returns `null`, keep legacy repository ownership checks in place for old `workspace_id = null` projects.

- [ ] **Step 9: Enforce owner/admin for billing and provider connection management**

For billing, subscription, cancellation, provider connect, provider disconnect, token rotation, and credential mutation endpoints, call:

```ts
await this.workspaceAccessService.assertWorkspaceRole(workspaceId, userId, [
  'owner',
  'admin',
]);
```

Read-only billing/usage display may allow all workspace roles. Mutating plan state, stored credentials, or provider connection state must not allow `developer` or `viewer`.

- [ ] **Step 10: Run authorization tests**

Run:

```powershell
npm test -- src/modules/projects/projects.repository.spec.ts src/modules/projects/projects.service.spec.ts src/modules/env-provisioning/deployment-targets.repository.spec.ts src/modules/env-provisioning/deployment-targets.service.spec.ts src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts src/modules/usage/usage.controller.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add src/modules/projects src/modules/env-provisioning src/modules/workspaces src/modules/usage src/modules/provider-connections
git commit -m "feat: enforce workspace roles for project access"
```

---

## Task 4: Audit And Notification Producers

**Files:**
- Modify: `cicd-workflow-be/src/modules/audit/audit-events.service.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.repository.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.service.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.controller.ts`
- Create: `cicd-workflow-be/src/modules/notifications/notification-events.service.ts`
- Modify: `cicd-workflow-be/src/modules/notifications/notifications.module.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.ts`
- Test: `cicd-workflow-be/src/modules/audit/audit-events.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/notifications/notifications.repository.spec.ts`
- Test: `cicd-workflow-be/src/modules/notifications/notifications.controller.spec.ts`
- Test: `cicd-workflow-be/src/modules/notifications/notification-events.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/env-vars.service.spec.ts`

- [ ] **Step 1: Add notification repository create test**

In `notifications.repository.spec.ts`, add:

```ts
it('creates a notification for a user', async () => {
  query.mockResolvedValueOnce({
    rows: [
      {
        id: 'notification-1',
        title: 'Quota reached',
        body: 'Project quota reached.',
        event_code: 'quota_reached',
        read_at: null,
        created_at: new Date('2026-06-15T00:00:00.000Z'),
      },
    ],
  });

  await expect(
    repository.createForUser({
      userId: 'user-1',
      projectId: 'project-1',
      eventCode: 'quota_reached',
      title: 'Quota reached',
      body: 'Project quota reached.',
    }),
  ).resolves.toMatchObject({
    id: 'notification-1',
    eventCode: 'quota_reached',
    readAt: null,
  });
});
```

- [ ] **Step 2: Implement `createForUser`**

Add to `notifications.repository.ts`:

```ts
async createForUser(input: {
  userId: string;
  projectId?: string | null;
  eventCode: string;
  title: string;
  body: string;
}): Promise<NotificationItem> {
  const result = await this.databaseService.query<NotificationRow>(
    `
      INSERT INTO notifications.notifications (
        user_id,
        project_id,
        event_code,
        title,
        body
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, body, event_code, read_at, created_at;
    `,
    [
      input.userId,
      input.projectId ?? null,
      input.eventCode,
      input.title,
      input.body,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Notification insert did not return a row');
  }
  return this.toItem(row);
}
```

- [ ] **Step 3: Add notification event service tests**

Create `notification-events.service.spec.ts`:

```ts
import { NotificationEventsService } from './notification-events.service';

describe('NotificationEventsService', () => {
  const repository = { createForUser: jest.fn() };
  const configService = { getOrThrow: jest.fn() };
  let service: NotificationEventsService;

  beforeEach(() => {
    jest.resetAllMocks();
    configService.getOrThrow.mockReturnValue({ notifications: { enabled: true } });
    service = new NotificationEventsService(repository as never, configService as never);
  });

  it('does not create notifications when disabled', async () => {
    configService.getOrThrow.mockReturnValue({ notifications: { enabled: false } });

    await service.record({
      userId: 'user-1',
      projectId: 'project-1',
      eventCode: 'quota_reached',
      title: 'Quota reached',
      body: 'Project quota reached.',
    });

    expect(repository.createForUser).not.toHaveBeenCalled();
  });

  it('creates notifications when enabled', async () => {
    await service.record({
      userId: 'user-1',
      projectId: 'project-1',
      eventCode: 'quota_reached',
      title: 'Quota reached',
      body: 'Project quota reached.',
    });

    expect(repository.createForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      eventCode: 'quota_reached',
      title: 'Quota reached',
      body: 'Project quota reached.',
    });
  });
});
```

- [ ] **Step 4: Add notification preference tests**

Add controller/service/repository tests for:

- `GET /notifications/preferences` returns current user preferences
- `PATCH /notifications/preferences` updates `in_app_enabled`
- `PATCH /notifications/preferences` accepts `email_enabled` but the frontend leaves that control disabled until email delivery exists

Repository SQL shape:

```sql
INSERT INTO notifications.notification_preferences (user_id, in_app_enabled, email_enabled)
VALUES ($1, $2, $3)
ON CONFLICT (user_id)
DO UPDATE SET
  in_app_enabled = EXCLUDED.in_app_enabled,
  email_enabled = EXCLUDED.email_enabled,
  updated_at = now()
RETURNING user_id, in_app_enabled, email_enabled, updated_at;
```

- [ ] **Step 5: Implement notification event service**

Create `notification-events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import { NotificationsRepository } from './notifications.repository';

export interface NotificationEventInput {
  userId: string;
  projectId?: string | null;
  eventCode: string;
  title: string;
  body: string;
}

@Injectable()
export class NotificationEventsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly configService: ConfigService,
  ) {}

  async record(input: NotificationEventInput): Promise<void> {
    const config = this.configService.getOrThrow<AppConfig>('app');
    if (!config.notifications.enabled) {
      return;
    }
    await this.repository.createForUser(input);
  }
}
```

- [ ] **Step 6: Add notification preference endpoints**

Add endpoints:

```ts
@Get('preferences')
getPreferences(@Req() req: Request) {
  return this.notificationsService.getPreferences(this.requireUserId(req));
}

@Patch('preferences')
updatePreferences(
  @Req() req: Request,
  @Body() body: { inAppEnabled?: boolean; emailEnabled?: boolean },
) {
  return this.notificationsService.updatePreferences(this.requireUserId(req), body);
}
```

- [ ] **Step 7: Add audit helper**

In `audit-events.service.ts`, add:

```ts
async recordProjectEvent(input: {
  actorUserId: string;
  workspaceId?: string | null;
  projectId: string;
  eventCode: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await this.record(input);
}
```

- [ ] **Step 8: Wire required event codes**

Add audit writes for:

- `project_created`
- `workflow_pr_created`
- `ci_token_rotated`
- `deployment_target_created`
- `deployment_target_updated`
- `deployment_target_detached`
- `env_vars_provisioned`
- `env_var_deleted`
- `project_snapshot_synced`
- `drift_repair_completed`
- `quota_blocked`

Add notification writes for:

- `workflow_failure`
- `provider_disconnected`
- `deployment_failure`
- `drift_detected`
- `quota_reached`
- `workflow_pr_created`

Each write must happen after the owning action succeeds. For quota blocks, write inside the catch path where the service converts quota failure to an API error.

- [ ] **Step 9: Run event tests**

Run:

```powershell
npm test -- src/modules/audit/audit-events.service.spec.ts src/modules/notifications/notifications.repository.spec.ts src/modules/notifications/notifications.controller.spec.ts src/modules/notifications/notification-events.service.spec.ts src/modules/projects/projects.service.spec.ts src/modules/env-provisioning/deployment-targets.service.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/modules/audit src/modules/notifications src/modules/projects src/modules/env-provisioning
git commit -m "feat: record dashboard audit and notification events"
```

---

## Task 5: Frontend Workspace Switcher, Members, And Notification Center

**Files:**
- Modify: `cicd-workflow-fe/src/lib/api/contracts.ts`
- Modify: `cicd-workflow-fe/src/lib/api/workspaces.ts`
- Modify: `cicd-workflow-fe/src/lib/api/notifications.ts`
- Modify: `cicd-workflow-fe/src/lib/api/projects.ts`
- Create: `cicd-workflow-fe/src/components/layout/workspace-context.tsx`
- Create: `cicd-workflow-fe/src/components/layout/workspace-switcher.tsx`
- Create: `cicd-workflow-fe/src/components/layout/notification-center.tsx`
- Create: `cicd-workflow-fe/src/components/settings/workspace-members-section.tsx`
- Create: `cicd-workflow-fe/src/components/settings/notification-preferences-section.tsx`
- Modify: `cicd-workflow-fe/src/components/layout/app-nav.tsx`
- Modify: `cicd-workflow-fe/src/app/settings/page.tsx`
- Modify: `cicd-workflow-fe/src/app/billing/page.tsx`
- Modify: `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`
- Test: `cicd-workflow-fe/tests/unit/api-client.test.ts`
- Test: `cicd-workflow-fe/tests/unit/workspace-switcher.test.tsx`
- Test: `cicd-workflow-fe/tests/unit/notification-center.test.tsx`
- Test: `cicd-workflow-fe/tests/unit/workspace-members-section.test.tsx`
- Test: `cicd-workflow-fe/tests/unit/notification-preferences-section.test.tsx`

- [ ] **Step 1: Add frontend contracts**

Add to `contracts.ts`:

```ts
export type WorkspaceRole = "owner" | "admin" | "developer" | "viewer";

export interface WorkspaceMemberSummary {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  login: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AddWorkspaceMemberRequest {
  loginOrEmail: string;
  role: WorkspaceRole;
}

export interface UpdateWorkspaceMemberRoleRequest {
  role: WorkspaceRole;
}

export interface NotificationPreferences {
  userId: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  updatedAt: string;
}

export interface UpdateNotificationPreferencesRequest {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
}
```

- [ ] **Step 2: Add workspace API methods**

Add to `workspaces.ts`:

```ts
export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberSummary[]> {
  return request<WorkspaceMemberSummary[]>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );
}

export async function addWorkspaceMember(
  workspaceId: string,
  payload: AddWorkspaceMemberRequest,
): Promise<WorkspaceMemberSummary> {
  return request<WorkspaceMemberSummary>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  payload: UpdateWorkspaceMemberRoleRequest,
): Promise<WorkspaceMemberSummary> {
  return request<WorkspaceMemberSummary>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string,
): Promise<{ id: string; removed: true }> {
  return request<{ id: string; removed: true }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE" },
  );
}
```

Add notification preference API methods:

```ts
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/notifications/preferences");
}

export async function updateNotificationPreferences(
  payload: UpdateNotificationPreferencesRequest,
): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
```

Update project list calls to accept selected workspace:

```ts
export async function getProjects(input?: {
  workspaceId?: string | null;
}): Promise<ProjectListResponse> {
  const params = new URLSearchParams();
  if (input?.workspaceId) params.set("workspaceId", input.workspaceId);
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ProjectListResponse>(`/projects${suffix}`);
}
```

- [ ] **Step 3: Add API client tests**

In `api-client.test.ts`, add tests asserting the exact routes:

```ts
await getWorkspaceMembers("workspace-1");
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining("/workspaces/workspace-1/members"),
  expect.any(Object),
);
```

Repeat for add, update role, and remove.

Add tests for:

- `getNotificationPreferences()` calls `/notifications/preferences`
- `updateNotificationPreferences()` sends PATCH
- `getProjects({ workspaceId: "workspace-1" })` appends `?workspaceId=workspace-1`

- [ ] **Step 4: Create `WorkspaceContext`**

Create `workspace-context.tsx` with:

- selected workspace id state
- initial value from `localStorage.getItem("flowci.workspaceId")`
- fallback to the first `GET /workspaces/me` item
- setter that persists `flowci.workspaceId`
- exported hook `useWorkspaceSelection()`

If the stored workspace id is not in `workspaces.items`, replace it with the first available workspace id.

- [ ] **Step 5: Create `WorkspaceSwitcher`**

Create a compact app-shell control:

```tsx
"use client";

import type { WorkspacesMeResponse } from "@/lib/api/contracts";

export function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspacesMeResponse | null }) {
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceSelection();
  const current =
    workspaces?.items.find((item) => item.id === selectedWorkspaceId) ??
    workspaces?.items[0] ??
    null;

  return (
    <div className="workspace-switcher" aria-label="Workspace switcher">
      <span>{current?.name ?? "Workspace"}</span>
      <small>{current ? `${current.kind} / ${current.role}` : "Loading"}</small>
    </div>
  );
}
```

If there is more than one workspace, render a native `<select aria-label="Current workspace">`. Selecting a workspace updates context/localStorage and causes project list API calls to include `workspaceId`.

- [ ] **Step 6: Create `NotificationCenter`**

Create a button/popover with:

- unread count badge
- list of title/body/event code
- `Mark read` button for unread items
- empty state `No notifications.`

- [ ] **Step 7: Create `WorkspaceMembersSection`**

Implement:

- member list
- add member form with GitHub login/email and role select
- role update select for owner/admin users
- remove button disabled for the current owner
- role management disabled for non-owner/admin users
- error message from API response

- [ ] **Step 8: Create `NotificationPreferencesSection`**

Implement:

- in-app notification toggle wired to `PATCH /notifications/preferences`
- email notification toggle rendered disabled with label `Email delivery unavailable`
- error message from API response
- loading and empty states

- [ ] **Step 9: Wire app shell and Settings**

In `app-nav.tsx`, load workspaces and notifications through existing API functions when authenticated. Render:

```tsx
<WorkspaceSwitcher workspaces={workspaces} />
<NotificationCenter notifications={notifications} onMarkRead={handleMarkNotificationRead} />
```

Wrap authenticated content with `WorkspaceProvider`.

In `settings/page.tsx`, replace the disabled `Members` button with:

```tsx
<WorkspaceMembersSection workspace={workspace} currentUserId={session?.user.id ?? ""} />
<NotificationPreferencesSection />
```

- [ ] **Step 10: Wire workspace selection into project views**

In project dashboard pages/components that call `getProjects`, read `selectedWorkspaceId` from `useWorkspaceSelection()` and pass it to `getProjects({ workspaceId: selectedWorkspaceId })`.

When selected workspace changes:

- reload the project list
- clear the currently selected project if it is not in the new list
- preserve old behavior when no selected workspace id exists

- [ ] **Step 11: Gate Billing and provider connection controls by role**

In Billing and provider connection UI, use the selected workspace role:

- owner/admin: show enabled management controls
- developer/viewer: show read-only plan/usage state and disabled management controls

Do not hide read-only usage. Disable or hide only actions that mutate plan, subscription, provider credentials, provider connection state, or billing state.

- [ ] **Step 12: Run frontend unit tests without global coverage**

Because `jest.config.js` collects global coverage for all targeted runs, run:

```powershell
npx jest tests/unit/api-client.test.ts tests/unit/workspace-switcher.test.tsx tests/unit/notification-center.test.tsx tests/unit/workspace-members-section.test.tsx tests/unit/notification-preferences-section.test.tsx --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 13: Commit**

```powershell
git add src/lib/api src/components/layout src/components/settings src/app/settings src/app/billing src/components/product tests/unit
git commit -m "feat: add workspace and notification dashboard UI"
```

---

## Task 6: Dedicated Audit Tab

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`
- Test: `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`

- [ ] **Step 1: Add failing test for Audit tab**

In `project-env-panel.test.tsx`, add:

```ts
expect(rendered.container.textContent).toContain("Audit");
expect(rendered.container.textContent).toContain("Activity");
```

Click `Audit` and assert audit event rendering appears there, not only under Activity.

- [ ] **Step 2: Extend tab union**

Change:

```ts
type ProjectDetailTab =
  | "overview"
  | "workflow"
  | "runs"
  | "deployments"
  | "environment"
  | "activity"
  | "audit"
  | "settings";
```

Add `{ id: "audit", label: "Audit" }` to `PROJECT_DETAIL_TABS`.

- [ ] **Step 3: Move audit rendering to Audit tab**

Keep `Activity` for human-readable timeline/empty state. Render audit rows only when `projectDetailTab === "audit"`:

```tsx
{projectDetailTab === "audit" ? (
  auditError ? (
    <p className="error-text" style={{ margin: 0 }}>{auditError}</p>
  ) : auditResponse?.items.length ? (
    <div className="env-metadata-list">
      {auditResponse.items.map((event) => (
        <div key={event.id} className="env-metadata-row provisioned">
          <span>{event.eventCode}</span>
          <span>{event.message}</span>
        </div>
      ))}
    </div>
  ) : (
    <p className="env-empty-state">No audit events yet.</p>
  )
) : null}
```

- [ ] **Step 4: Run frontend test**

```powershell
npx jest tests/unit/project-env-panel.test.tsx --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/product/workflow-current-tab.tsx tests/unit/project-env-panel.test.tsx
git commit -m "feat: add project audit tab"
```

---

## Task 7: Quota UX Before Creation And Env Provision

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/workflow-setup-tab.tsx`
- Modify: `cicd-workflow-fe/src/components/product/project-env-panel.tsx`
- Modify: `cicd-workflow-fe/src/components/product/workflow-builder-utils.ts`
- Modify: `cicd-workflow-fe/src/app/billing/page.tsx`
- Test: `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`

- [ ] **Step 1: Add quota display helper**

Add helper:

```ts
export function formatQuotaStatus(input: {
  current: number;
  limit: number;
  upgradeRequired: boolean;
}): string {
  if (input.limit <= 0) return "Unavailable";
  const remaining = Math.max(0, input.limit - input.current);
  if (remaining === 0) {
    return input.upgradeRequired
      ? "Limit reached. Upgrade to continue."
      : "Limit reached.";
  }
  return `${remaining} remaining`;
}
```

- [ ] **Step 2: Add Project quota panel**

In `workflow-setup-tab.tsx`, load `getMyUsage()` before submit and show the `projects` item near the submit button:

```tsx
<div className="env-empty-state" role="status">
  Project quota: {formatQuotaStatus(projectQuota)}
</div>
```

Disable submit when `projects.current >= projects.limit`.

- [ ] **Step 3: Add Env key quota panel**

In `project-env-panel.tsx`, show `env_keys` quota near `Provision`. Disable provision when quota is reached.

- [ ] **Step 4: Add managed resource exposure view**

In Billing/Usage and the env provisioning panel, show the managed resources currently visible to the app:

- project count and project limit
- env key count and env key limit
- connected repository count if present in the usage response
- deployment target count if present in the usage response

Use existing usage response fields first. If connected repository or deployment target counts are not returned yet, show only the counts available from `getMyUsage()` and record the missing fields in the implementation log rather than inventing frontend-only numbers.

- [ ] **Step 5: Normalize quota API errors**

Update `formatApiError` to return:

```ts
"Quota reached. Upgrade your plan or remove unused resources."
```

when status is `402`, `403`, or response code is `quota_exceeded`.

- [ ] **Step 6: Run quota UI tests**

```powershell
npx jest tests/unit/project-env-panel.test.tsx --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/components/product src/hooks src/lib/api tests/unit
git commit -m "feat: show quota limits before dashboard actions"
```

---

## Task 8: Complete Workflow Settings Editor

**Files:**
- Modify: `cicd-workflow-fe/src/lib/api/contracts.ts`
- Modify: `cicd-workflow-fe/src/components/product/workflow-current-tab.tsx`
- Test: `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`
- Test: `cicd-workflow-fe/tests/unit/api-client.test.ts`

- [ ] **Step 1: Add frontend tests for missing fields**

Test that the Workflow tab renders:

- `Workflow recipe`
- `Package manager`
- `Lint`
- `Unit tests`
- `Build`
- `Security`
- `Deploy target mappings`

- [ ] **Step 2: Render all settings fields**

In the Workflow Settings panel, render controls bound to:

```tsx
workflowSettings.workflowRecipeId
workflowSettings.packageManager
workflowSettings.checks.lint
workflowSettings.checks.unit
workflowSettings.checks.build
workflowSettings.checks.security
workflowSettings.deployTargets
```

Use native selects/checkboxes to match existing code style. Keep `packageManager` as disabled `npm` until backend supports more values.

- [ ] **Step 3: Improve preview diff badges**

Change diff rendering to show:

```tsx
<span className={item.status === "changed" ? "dash-badge-violet" : "branch-chip"}>
  {item.status}
</span>
```

Generated file paths remain visible beside badges.

- [ ] **Step 4: Keep PR-first behavior**

Keep direct apply absent. `Create update PR` remains hidden until preview succeeds.

- [ ] **Step 5: Run Workflow Settings tests**

```powershell
npx jest tests/unit/api-client.test.ts tests/unit/project-env-panel.test.tsx --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/api/contracts.ts src/components/product/workflow-current-tab.tsx tests/unit
git commit -m "feat: complete workflow settings editor"
```

---

## Task 9: Browser Verification Pass

**Files:**
- No source files.

- [ ] **Step 1: Restart local app**

From `C:\Codes\cicd-ex` run:

```powershell
.\restart-local.ps1
```

Expected:

- backend health on `http://localhost:4000/api/v1/health`
- frontend on `http://localhost:3000`

- [ ] **Step 2: Verify `/workflows` project dashboard**

Open `http://localhost:3000/workflows`, select `Current Projects`, and verify:

- `Overview`, `Workflow`, `Runs`, `Deployments`, `Environment`, `Activity`, `Audit`, `Settings` tabs render
- Workflow Settings shows all fields from Task 8
- Audit tab renders `No audit events yet.` or event rows
- Runs tab shows local/mock message
- Deployments tab shows local/mock message
- Environment tab shows target and env-var controls

- [ ] **Step 3: Verify `/settings`**

Open `http://localhost:3000/settings` and verify:

- workspace section shows member list
- add member form is present
- notifications are no longer only buried in Settings because app shell notification center is visible
- usage still appears under Billing

- [ ] **Step 4: Verify app shell**

From any authenticated route, verify:

- workspace switcher visible
- notification center visible
- unread count visible

- [ ] **Step 5: Capture final browser findings**

Write any manual findings into the implementation log or final response. Do not claim visual completion without these checks.

---

## Task 10: Full Test And Build Verification

**Files:**
- No source files unless failures require fixes.

- [ ] **Step 1: Backend targeted tests**

```powershell
npm test -- src/modules/workspaces/workspaces.repository.spec.ts src/modules/workspaces/workspaces.service.spec.ts src/modules/workspaces/workspaces.controller.spec.ts src/modules/workspaces/workspace-access.service.spec.ts src/modules/notifications/notifications.repository.spec.ts src/modules/notifications/notification-events.service.spec.ts src/modules/audit/audit-events.service.spec.ts src/modules/projects/projects.repository.spec.ts src/modules/projects/projects.service.spec.ts src/modules/env-provisioning/deployment-targets.repository.spec.ts src/modules/env-provisioning/deployment-targets.service.spec.ts src/modules/env-provisioning/env-vars.repository.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts src/modules/capabilities/capabilities.controller.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Backend full tests**

```powershell
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Backend build**

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Frontend targeted tests**

```powershell
npx jest tests/unit/api-client.test.ts tests/unit/project-env-panel.test.tsx tests/unit/workspace-switcher.test.tsx tests/unit/notification-center.test.tsx tests/unit/workspace-members-section.test.tsx --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 5: Frontend full tests**

```powershell
npm test -- --runInBand
```

Expected: PASS including coverage thresholds.

- [ ] **Step 6: Frontend build**

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 7: Diff hygiene**

From `C:\Codes\cicd-ex` run:

```powershell
git -C cicd-workflow-be status --short
git -C cicd-workflow-fe status --short
```

Expected: only intentional files are modified. Do not revert user changes.

---

## Completion Checklist

- [ ] Workspace switcher is visible in the app shell.
- [ ] Selected workspace persists and filters project list calls by `workspaceId`.
- [ ] Workspace member list/add/update/remove are implemented.
- [ ] Last workspace owner cannot be demoted or removed.
- [ ] Project and env authorization honor workspace roles while preserving old user-owned projects.
- [ ] Billing and provider connection mutations require owner/admin.
- [ ] Separate project Audit tab exists.
- [ ] Audit writes cover project creation, workflow PRs, CI token rotation, target updates, env vars, sync, repair, and quota blocks.
- [ ] Notification center exists in app shell.
- [ ] Notification preferences are readable and editable for in-app notifications.
- [ ] Notifications are generated by product events, not only readable from the table.
- [ ] Quota state appears before project creation and env provisioning submit.
- [ ] Managed resource exposure appears in Billing/Usage and env provisioning surfaces for fields returned by `getMyUsage()`.
- [ ] Full Workflow Settings editor fields are visible and included in preview payloads.
- [ ] Direct workflow apply remains absent; PR-first flow remains.
- [ ] Phase 13 live-provider activation remains honestly deferred unless a separate plan enables it.
- [ ] Backend targeted tests pass.
- [ ] Backend full tests pass.
- [ ] Backend build passes.
- [ ] Frontend targeted tests pass.
- [ ] Frontend full tests pass.
- [ ] Frontend build passes.
- [ ] Browser route audit passes for `/workflows` and `/settings`.

---

## Out Of Scope For This Plan

- Live GitHub Actions API adapter.
- Live Render/Vercel deployment history adapter.
- Live provider repair mutations.
- Email notification delivery.
- Project-specific membership overrides outside workspace membership.
- A public team invite flow for users who have never signed into FlowCI Studio.
