-- Rollback: allow new BYO provider connection inserts again.

BEGIN;

DROP TRIGGER IF EXISTS reject_new_legacy_provider_connections ON env_provisioning.provider_connections;
DROP FUNCTION IF EXISTS env_provisioning.reject_new_legacy_provider_connections();

COMMIT;