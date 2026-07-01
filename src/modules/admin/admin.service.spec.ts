import { AdminService } from './admin.service';

describe('AdminService GCP runtime admin visibility', () => {
  const adminRepository = {
    listGcpRuntimeProjects: jest.fn(),
  };
  const platformAdminsRepository = {};
  const auditEventsRepository = {
    create: jest.fn(),
  };
  const feedbackService = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the read model and audits the admin access', async () => {
    adminRepository.listGcpRuntimeProjects.mockResolvedValueOnce([
      {
        workspace_id: 'workspace-1',
        workspace_name: 'AlphaExplora',
        project_id: 'project-1',
        repo_full_name: 'alpha/demo',
        owner_login: 'anton',
        runtime_scope: 'dedicated_customer_project',
        environment: 'prod',
        service_slot: 'api',
        deployment_status: 'blocked_by_access',
        provisioning_status: 'failed',
        gcp_project_id: 'customer-alpha-prod',
        region: 'asia-southeast1',
        cloud_run_service_name: 'alpha-api-prod',
        last_reconciliation_status: 'blocked_by_access',
        last_reconciliation_checked_at: null,
        last_deployment_error_code: 'MISSING_GCP_IAM',
        last_job_id: 'job-1',
        last_job_type: 'provision_runtime',
        last_job_status: 'failed',
        last_job_updated_at: '2026-07-02T01:00:00.000Z',
        last_job_error_code: 'missing_iam',
        domain_hostname: null,
        domain_kind: null,
        certificate_status: null,
        preview_count: 0,
        blocked_entitlement_reason: null,
        last_audit_event_code: null,
        last_audit_event_message: null,
        last_audit_event_created_at: null,
      },
    ]);

    const service = new AdminService(
      adminRepository as never,
      platformAdminsRepository as never,
      auditEventsRepository as never,
      feedbackService as never,
    );

    await expect(
      service.listGcpRuntimeProjects('admin-1', {
        status: 'blocked_by_access',
        runtimePlacement: 'dedicated_customer_project',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          workspace: { id: 'workspace-1', name: 'AlphaExplora' },
          runtime: {
            placement: 'dedicated_customer_project',
            deploymentStatus: 'blocked_by_access',
          },
          needsAttention: true,
        },
      ],
      total: 1,
    });

    expect(adminRepository.listGcpRuntimeProjects).toHaveBeenCalledWith({
      status: 'blocked_by_access',
      runtimePlacement: 'dedicated_customer_project',
    });
    expect(auditEventsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        eventCode: 'admin.gcp_runtime.viewed',
        message: 'Admin viewed GCP runtime readiness',
      }),
    );
  });
});
