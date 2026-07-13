-- Reverts 20260713060000_group_lifecycle.sql
--
-- Drops the new table first (also drops its indexes), then the added
-- columns in reverse order. idx_workspace_members_active depends on
-- member_status and must be dropped before that column, or the ALTER TABLE
-- DROP COLUMN will fail.
--
-- No existing data is touched: orgs.workspaces.kind and
-- orgs.workspace_members.role are never referenced here.

DROP TABLE IF EXISTS orgs.group_invitations;

DROP INDEX IF EXISTS orgs.idx_workspace_members_active;

ALTER TABLE orgs.workspace_members
  DROP COLUMN IF EXISTS removal_reason,
  DROP COLUMN IF EXISTS removed_by,
  DROP COLUMN IF EXISTS removed_at,
  DROP COLUMN IF EXISTS invited_at,
  DROP COLUMN IF EXISTS invited_by,
  DROP COLUMN IF EXISTS member_status;

ALTER TABLE orgs.workspaces
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS business_unit,
  DROP COLUMN IF EXISTS description;
