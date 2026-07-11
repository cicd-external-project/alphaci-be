-- Rollback: env_provisioning
--
-- Use only if the environment provisioning migration must be reverted in
-- production. This is destructive for env provisioning metadata only:
-- provider connection metadata, deployment target metadata, and env-var
-- provisioning metadata will be removed. It does not delete Render/Vercel
-- resources or provider-side environment variables.

BEGIN;

DROP TRIGGER IF EXISTS trg_project_env_var_metadata_updated_at ON env_provisioning.project_env_var_metadata;
DROP TRIGGER IF EXISTS trg_project_deployment_targets_updated_at ON env_provisioning.project_deployment_targets;
DROP TRIGGER IF EXISTS trg_provider_connections_updated_at ON env_provisioning.provider_connections;

DROP TABLE IF EXISTS env_provisioning.project_env_var_metadata;
DROP TABLE IF EXISTS env_provisioning.project_deployment_targets;
DROP TABLE IF EXISTS env_provisioning.provider_connections;

DROP FUNCTION IF EXISTS env_provisioning.set_env_provisioning_updated_at();
DROP SCHEMA IF EXISTS env_provisioning;

COMMIT;
