-- Reverts 20260616_sync_tables_enable_rls.sql.
--
-- WARNING: disabling RLS re-opens these tables to the public Supabase keys and
-- re-introduces the security exposure. The original table-level grants are NOT
-- restored here because the original (exposed) grant state is environment
-- specific; re-grant manually only if a rollback genuinely requires it.

ALTER TABLE projects.project_dashboard_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_sync_findings        DISABLE ROW LEVEL SECURITY;
