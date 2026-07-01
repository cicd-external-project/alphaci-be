-- Rollback: gcp_runtime_expand_contract
--
-- Destructive for GCP runtime metadata only. Use only before production GCP
-- runtime rows exist, or after a separate data-preserving rollback plan.
-- This does not touch env_provisioning, provider_connections, or legacy
-- Vercel/Render deployment target records.

BEGIN;

DROP TRIGGER IF EXISTS trg_gcp_runtime_cost_summaries_updated_at ON billing_lifecycle.runtime_cost_summaries;
DROP TRIGGER IF EXISTS trg_gcp_provisioning_jobs_updated_at ON gcp_operations.provisioning_jobs;
DROP TRIGGER IF EXISTS trg_gcp_secret_references_updated_at ON runtime_secrets.secret_references;
DROP TRIGGER IF EXISTS trg_gcp_domain_records_updated_at ON runtime_domains.domain_records;
DROP TRIGGER IF EXISTS trg_gcp_deployment_targets_updated_at ON runtime_deployments.deployment_targets;

DROP TABLE IF EXISTS billing_lifecycle.runtime_cost_summaries;
DROP TABLE IF EXISTS gcp_operations.provisioning_jobs;
DROP TABLE IF EXISTS runtime_secrets.secret_references;
DROP TABLE IF EXISTS runtime_domains.domain_records;
DROP TABLE IF EXISTS runtime_deployments.deployment_attempts;
DROP TABLE IF EXISTS runtime_deployments.deployment_targets;

DROP FUNCTION IF EXISTS gcp_operations.set_gcp_runtime_updated_at();

DROP SCHEMA IF EXISTS billing_lifecycle;
DROP SCHEMA IF EXISTS runtime_secrets;
DROP SCHEMA IF EXISTS runtime_domains;
DROP SCHEMA IF EXISTS runtime_deployments;
DROP SCHEMA IF EXISTS gcp_operations;

COMMIT;
