DROP INDEX IF EXISTS env_provisioning.idx_project_env_var_metadata_active;

ALTER TABLE env_provisioning.project_env_var_metadata
  DROP COLUMN IF EXISTS removed_at;
