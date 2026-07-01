import {
  toAdminGcpRuntimeProject,
  type AdminGcpRuntimeRow,
} from './gcp-runtime-admin.view';

describe('gcp-runtime-admin.view', () => {
  const row: AdminGcpRuntimeRow = {
    workspace_id: 'workspace-1',
    workspace_name: 'AlphaExplora',
    project_id: 'project-1',
    repo_full_name: 'alpha/demo',
    owner_login: 'anton',
    runtime_scope: 'shared_project',
    environment: 'prod',
    service_slot: 'web',
    deployment_status: 'drifted',
    provisioning_status: 'provisioned',
    gcp_project_id: 'alphaci-shared-prod',
    region: 'asia-southeast1',
    cloud_run_service_name: 'alpha-demo-prod',
    last_reconciliation_status: 'drifted',
    last_reconciliation_checked_at: '2026-07-02T01:00:00.000Z',
    last_deployment_error_code: 'CLOUD_RUN_SERVICE_MISSING',
    last_job_id: 'job-1',
    last_job_type: 'reconcile_runtime',
    last_job_status: 'failed',
    last_job_updated_at: '2026-07-02T01:01:00.000Z',
    last_job_error_code: 'missing_service',
    domain_hostname: 'alpha-demo.itsandbox.site',
    domain_kind: 'generated_default',
    certificate_status: 'active',
    preview_count: 2,
    blocked_entitlement_reason: 'PAYMENT_PAST_DUE',
    last_audit_event_code: 'gcp.runtime.reconcile.drifted',
    last_audit_event_message: 'Runtime drift detected',
    last_audit_event_created_at: '2026-07-02T01:02:00.000Z',
  };

  it('maps DB rows to a safe operational admin read model', () => {
    expect(toAdminGcpRuntimeProject(row)).toEqual({
      workspace: { id: 'workspace-1', name: 'AlphaExplora' },
      project: {
        id: 'project-1',
        repository: 'alpha/demo',
        ownerLogin: 'anton',
      },
      runtime: {
        placement: 'shared_project',
        environment: 'prod',
        serviceSlot: 'web',
        deploymentStatus: 'drifted',
        provisioningStatus: 'provisioned',
        gcpProjectId: 'alphaci-shared-prod',
        region: 'asia-southeast1',
        cloudRunServiceName: 'alpha-demo-prod',
      },
      reconciliation: {
        status: 'drifted',
        checkedAt: '2026-07-02T01:00:00.000Z',
        errorCode: 'CLOUD_RUN_SERVICE_MISSING',
      },
      lastProvisioningJob: {
        id: 'job-1',
        type: 'reconcile_runtime',
        status: 'failed',
        updatedAt: '2026-07-02T01:01:00.000Z',
        errorCode: 'missing_service',
      },
      domain: {
        hostname: 'alpha-demo.itsandbox.site',
        kind: 'generated_default',
        certificateStatus: 'active',
      },
      previewCount: 2,
      blockedEntitlementReason: 'PAYMENT_PAST_DUE',
      lastAuditEvent: {
        code: 'gcp.runtime.reconcile.drifted',
        message: 'Runtime drift detected',
        createdAt: '2026-07-02T01:02:00.000Z',
      },
      needsAttention: true,
    });
  });

  it('does not mark healthy runtime rows as needing attention', () => {
    expect(
      toAdminGcpRuntimeProject({
        ...row,
        deployment_status: 'ready',
        last_reconciliation_status: 'ready',
        last_deployment_error_code: null,
        last_job_status: 'succeeded',
        last_job_error_code: null,
        certificate_status: 'active',
        blocked_entitlement_reason: null,
      }).needsAttention,
    ).toBe(false);
  });
});
