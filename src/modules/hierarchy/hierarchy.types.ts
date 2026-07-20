import type { WorkspaceRole } from '../workspaces/workspaces.repository';

/**
 * Group role wire values are the *existing* `orgs.workspace_members.role`
 * enum — a Group is an `orgs.workspaces` row with kind='team' (see
 * HIERARCHY_IMPLEMENTATION_PLAN.md §1.1/§1.2). Do not introduce a second role
 * enum here; FE must mirror this exact mapping (plan §2.1).
 */
export type GroupRole = WorkspaceRole;

/**
 * NOTE — `admin` overload (ROLE_VALUE_RENAME_PLAN.md §2.1): the wire value
 * `admin` here is the TOP group-membership tier (label "Lead", formerly
 * `owner`). It is a completely different system from platform-admin roles
 * (`identity.platform_admins.role`, `'admin' | 'super_admin'`) — do not
 * conflate the two when reading or editing role-gating code.
 */
export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  admin: 'Lead',
  delegated_lead: 'Delegated lead',
  member: 'Member',
  viewer: 'Viewer',
};

/** Roles that may invite/manage members, systems, delivery projects, repositories. */
export const GROUP_MANAGER_ROLES: GroupRole[] = ['admin', 'delegated_lead'];

/** Roles allowed on an invitation body — ownership only changes via transfer (plan §2.4). */
export type InvitableRole = Exclude<GroupRole, 'admin'>;

export type LifecycleStatus = 'active' | 'archived';

export type MemberStatus = 'invited' | 'active' | 'removed';

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired';

export type RepositoryStatus = 'pending' | 'active' | 'archived';

export type DesiredState = 'assigned' | 'unassigned';

export type EffectiveState =
  | 'unknown'
  | 'pending'
  | 'active'
  | 'revoking'
  | 'revoked'
  | 'failed';

export type AssignmentStatus = 'pending' | 'active' | 'revoked' | 'failed';

export type SyncState =
  | 'pending'
  | 'syncing'
  | 'verified'
  | 'failed'
  | 'drift_detected';

export type EnvironmentScope = 'non_production' | 'production';

export type ConfigurationType = 'variable' | 'secret';

export type ConfigurationAction = 'create' | 'update' | 'delete';

export type ApprovalState =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected';

export type ConfigurationSyncState = 'pending' | 'synced' | 'failed';

/** outbox_events.topic values (plan §1.7/§2.2) — additive data only, no new table. */
export const HIERARCHY_OUTBOX_TOPICS = {
  grant: 'hierarchy.repository_assignment.grant',
  revoke: 'hierarchy.repository_assignment.revoke',
  reconcile: 'hierarchy.repository_assignment.reconcile',
} as const;

export type HierarchyOutboxTopic =
  (typeof HIERARCHY_OUTBOX_TOPICS)[keyof typeof HIERARCHY_OUTBOX_TOPICS];

/** audit.audit_events.event_code values this module emits (plan §2.2). */
export const HIERARCHY_EVENT_CODES = {
  groupCreated: 'hierarchy.group.created',
  groupUpdated: 'hierarchy.group.updated',
  groupArchived: 'hierarchy.group.archived',
  groupReopened: 'hierarchy.group.reopened',
  groupDeleted: 'hierarchy.group.deleted',
  groupManagerTransferred: 'hierarchy.group.manager_transferred',
  invitationCreated: 'hierarchy.group.invitation_created',
  invitationAccepted: 'hierarchy.group.invitation_accepted',
  invitationDeclined: 'hierarchy.group.invitation_declined',
  invitationRevoked: 'hierarchy.group.invitation_revoked',
  invitationExpired: 'hierarchy.group.invitation_expired',
  memberRoleChanged: 'hierarchy.group.member_role_changed',
  memberRemoved: 'hierarchy.group.member_removed',
  systemCreated: 'hierarchy.system.created',
  systemUpdated: 'hierarchy.system.updated',
  systemArchived: 'hierarchy.system.archived',
  deliveryProjectCreated: 'hierarchy.delivery_project.created',
  deliveryProjectUpdated: 'hierarchy.delivery_project.updated',
  deliveryProjectArchived: 'hierarchy.delivery_project.archived',
  repositoryCreated: 'hierarchy.repository.created',
  repositoryArchived: 'hierarchy.repository.archived',
  assignmentRequested: 'hierarchy.assignment.requested',
  assignmentGrantVerified: 'hierarchy.assignment.grant_verified',
  assignmentGrantFailed: 'hierarchy.assignment.grant_failed',
  assignmentRevokeRequested: 'hierarchy.assignment.revoke_requested',
  assignmentRevokeVerified: 'hierarchy.assignment.revoke_verified',
  assignmentRevokeFailed: 'hierarchy.assignment.revoke_failed',
  assignmentDriftDetected: 'hierarchy.assignment.drift_detected',
  assignmentReconciled: 'hierarchy.assignment.reconciled',
  configurationVariableWritten: 'hierarchy.configuration.variable_written',
  configurationVariableDeleted: 'hierarchy.configuration.variable_deleted',
  configurationSecretWritten: 'hierarchy.configuration.secret_written',
  configurationSecretDeleted: 'hierarchy.configuration.secret_deleted',
} as const;
