-- Rollback: project_ci_tokens
--
-- Use only if the project CI token migration must be reverted in production.
-- This is destructive: it removes stored CI token hashes, so gated workflows
-- will stop authorizing until tokens are reissued.

BEGIN;

DROP TRIGGER IF EXISTS trg_project_ci_tokens_updated_at ON project_ci_tokens;
DROP FUNCTION IF EXISTS set_project_ci_tokens_updated_at();
DROP INDEX IF EXISTS idx_project_ci_tokens_hash_active;
DROP TABLE IF EXISTS project_ci_tokens;

COMMIT;
