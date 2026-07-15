-- Rollback for 20260713120000_enable_rls_auth_session_handoffs
--
-- Restores the prior (insecure) state: RLS disabled on the handoff table.
-- Note: this intentionally does NOT re-GRANT to anon/authenticated — the
-- pre-migration table had no explicit grants beyond PostgREST defaults, and
-- re-exposing it is exactly the risk the forward migration removes. Only run
-- this if the forward migration must be reverted for an unrelated reason.
ALTER TABLE identity.auth_session_handoffs DISABLE ROW LEVEL SECURITY;
