BEGIN;

DROP INDEX IF EXISTS env_provisioning.idx_project_deployment_targets_strategy;

ALTER TABLE env_provisioning.project_deployment_targets
  DROP CONSTRAINT IF EXISTS project_deployment_targets_strategy_check,
  DROP COLUMN IF EXISTS provider_metadata,
  DROP COLUMN IF EXISTS deployment_strategy;

ALTER TABLE env_provisioning.provider_connections
  DROP COLUMN IF EXISTS metadata;

COMMIT;
