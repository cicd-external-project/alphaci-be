-- Reverts 20260714000000_role_value_rename.sql
--
-- Drops the new CHECK by its known, explicit name (the up-migration created
-- it under that exact name, so no dynamic pg_constraint lookup by attnum is
-- needed here — that lookup was only necessary going forward because the
-- ORIGINAL pre-rename constraint's name was never guaranteed), remaps
-- orgs.workspace_members.role data back to the pre-rename vocabulary
-- (owner/admin/developer/viewer), and re-adds the original CHECK under the
-- same predictable name so the constraint name stays stable across up/down
-- cycles.
--
-- No `WHERE kind = ...` filter here either, for the same shared-column
-- reason as the up-migration (plan §1) — every row is remapped back
-- regardless of personal/team workspace kind.
--
-- ⚠️ Idempotency guard is NOT optional here, mirroring the up-migration.
-- 'admin' means the NEW top tier right now (post-rename) but meant the OLD
-- second tier before the rename — reusing that string is exactly why a
-- naive re-run is unsafe in either direction. Everything below runs inside
-- ONE DO block that first checks whether the CHECK constraint already
-- reflects the OLD vocabulary (using 'developer' as a marker string that
-- only ever appears in the OLD definition, never the new one) and exits
-- immediately if so, before any UPDATE runs.
--
-- STATEMENT ORDER IS LOAD-BEARING inside the block, mirroring the
-- up-migration's warning but reversed: 'admin' is currently the TOP tier
-- (post-rename, old 'owner') and must be moved to 'owner' FIRST; only AFTER
-- that has happened is it safe to move 'delegated_lead' rows into 'admin' —
-- otherwise the second UPDATE's freshly written 'admin' rows could be
-- re-matched by a not-yet-run first UPDATE still looking for
-- `WHERE role = 'admin'`. Do not reorder.
--
-- Does NOT touch orgs.group_invitations: that table's CHECK constraint was
-- authored directly with the new vocabulary in
-- 20260713060000_group_lifecycle.sql (see that file's comments and
-- 20260714000000_role_value_rename.sql's header for why), so rolling back
-- this migration alone does not need to revert it. If
-- 20260713060000_group_lifecycle.sql itself is rolled back, its own
-- rollback (20260713060000_group_lifecycle_down.sql) drops the table
-- entirely, which is the correct inverse for that file.
DO $$
DECLARE
  v_constraint_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'workspace_members_role_check'
    AND conrelid = 'orgs.workspace_members'::regclass;

  -- Already rolled back (or never migrated) — the current CHECK already
  -- speaks the old vocabulary. Skip everything below so re-running this
  -- file is a safe no-op.
  IF v_constraint_def IS NOT NULL AND v_constraint_def LIKE '%developer%' THEN
    RETURN;
  END IF;

  ALTER TABLE orgs.workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_role_check;

  UPDATE orgs.workspace_members SET role = 'owner'     WHERE role = 'admin';
  UPDATE orgs.workspace_members SET role = 'admin'     WHERE role = 'delegated_lead';
  UPDATE orgs.workspace_members SET role = 'developer' WHERE role = 'member';
  -- 'viewer' is unchanged.

  ALTER TABLE orgs.workspace_members
    ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'admin', 'developer', 'viewer'));
END $$;
