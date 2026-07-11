export const GCP_RUNTIME_ATTENTION_STATUSES = new Set([
  'failed',
  'drifted',
  'degraded',
  'blocked_by_access',
  'dead_letter',
]);

export interface AdminGcpRuntimeRow {
  workspace_id: string;
  workspace_name: string | null;
  project_id: string;
  repo_full_name: string;
  owner_login: string | null;
  runtime_scope: string;
  environment: string;
  service_slot: string;
  deployment_status: string;
  provisioning_status: string;
  gcp_project_id: string;
  region: string;
  cloud_run_service_name: string;
  last_reconciliation_status: string | null;
  last_reconciliation_checked_at: string | null;
  last_deployment_error_code: string | null;
  last_job_id: string | null;
  last_job_type: string | null;
  last_job_status: string | null;
  last_job_updated_at: string | null;
  last_job_error_code: string | null;
  domain_hostname: string | null;
  domain_kind: string | null;
  certificate_status: string | null;
  preview_count: number | string | null;
  blocked_entitlement_reason: string | null;
  last_audit_event_code: string | null;
  last_audit_event_message: string | null;
  last_audit_event_created_at: string | null;
}

export interface AdminGcpRuntimeProject {
  workspace: {
    id: string;
    name: string | null;
  };
  project: {
    id: string;
    repository: string;
    ownerLogin: string | null;
  };
  runtime: {
    placement: string;
    environment: string;
    serviceSlot: string;
    deploymentStatus: string;
    provisioningStatus: string;
    gcpProjectId: string;
    region: string;
    cloudRunServiceName: string;
  };
  reconciliation: {
    status: string | null;
    checkedAt: string | null;
    errorCode: string | null;
  };
  lastProvisioningJob: {
    id: string | null;
    type: string | null;
    status: string | null;
    updatedAt: string | null;
    errorCode: string | null;
  };
  domain: {
    hostname: string | null;
    kind: string | null;
    certificateStatus: string | null;
  };
  previewCount: number;
  blockedEntitlementReason: string | null;
  lastAuditEvent: {
    code: string | null;
    message: string | null;
    createdAt: string | null;
  };
  needsAttention: boolean;
}

export function toAdminGcpRuntimeProject(
  row: AdminGcpRuntimeRow,
): AdminGcpRuntimeProject {
  const states = [
    row.deployment_status,
    row.provisioning_status,
    row.last_reconciliation_status,
    row.last_job_status,
    row.certificate_status,
  ];

  return {
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
    },
    project: {
      id: row.project_id,
      repository: row.repo_full_name,
      ownerLogin: row.owner_login,
    },
    runtime: {
      placement: row.runtime_scope,
      environment: row.environment,
      serviceSlot: row.service_slot,
      deploymentStatus: row.deployment_status,
      provisioningStatus: row.provisioning_status,
      gcpProjectId: row.gcp_project_id,
      region: row.region,
      cloudRunServiceName: row.cloud_run_service_name,
    },
    reconciliation: {
      status: row.last_reconciliation_status,
      checkedAt: row.last_reconciliation_checked_at,
      errorCode: row.last_deployment_error_code,
    },
    lastProvisioningJob: {
      id: row.last_job_id,
      type: row.last_job_type,
      status: row.last_job_status,
      updatedAt: row.last_job_updated_at,
      errorCode: row.last_job_error_code,
    },
    domain: {
      hostname: row.domain_hostname,
      kind: row.domain_kind,
      certificateStatus: row.certificate_status,
    },
    previewCount: Number(row.preview_count ?? 0),
    blockedEntitlementReason: row.blocked_entitlement_reason,
    lastAuditEvent: {
      code: row.last_audit_event_code,
      message: row.last_audit_event_message,
      createdAt: row.last_audit_event_created_at,
    },
    needsAttention:
      states.some(
        (state) => state !== null && GCP_RUNTIME_ATTENTION_STATUSES.has(state),
      ) || row.blocked_entitlement_reason !== null,
  };
}
