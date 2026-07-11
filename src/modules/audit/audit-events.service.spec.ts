import {
  AuditEventsService,
  GCP_RUNTIME_AUDIT_EVENT_CODES,
} from './audit-events.service';

describe('AuditEventsService', () => {
  const repository = {
    create: jest.fn(),
    listByProjectForUser: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService.getOrThrow.mockReturnValue({
      auditEvents: { enabled: true },
    });
  });

  it('does not write audit rows when audit is disabled', async () => {
    configService.getOrThrow.mockReturnValueOnce({
      auditEvents: { enabled: false },
    });
    const service = new AuditEventsService(
      repository as never,
      configService as never,
    );

    await service.record({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('writes audit rows when audit is enabled', async () => {
    const service = new AuditEventsService(
      repository as never,
      configService as never,
    );

    await service.record({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });

    expect(repository.create).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: { pullRequestNumber: 42 },
    });
  });

  it('does not throw when project event recording fails', async () => {
    repository.create.mockRejectedValueOnce(new Error('database down'));
    const service = new AuditEventsService(
      repository as never,
      configService as never,
    );

    await expect(
      service.recordProjectEvent({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'workflow_pr_created',
        message: 'Workflow update PR created',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns disabled audit list when audit is disabled', async () => {
    configService.getOrThrow.mockReturnValueOnce({
      auditEvents: { enabled: false },
    });
    const service = new AuditEventsService(
      repository as never,
      configService as never,
    );

    await expect(
      service.listProjectEvents('project-1', 'user-1'),
    ).resolves.toEqual({ enabled: false, items: [] });
    expect(repository.listByProjectForUser).not.toHaveBeenCalled();
  });

  it('defines the GCP runtime audit events used by local readiness views', () => {
    expect(GCP_RUNTIME_AUDIT_EVENT_CODES).toEqual([
      'gcp.runtime.provision.requested',
      'gcp.runtime.provision.succeeded',
      'gcp.runtime.provision.failed',
      'gcp.runtime.reconcile.drifted',
      'gcp.domain.verification.requested',
      'gcp.domain.verification.succeeded',
      'gcp.preview.cleanup.requested',
      'gcp.preview.cleanup.succeeded',
      'legacy_provider_connection.create_blocked',
    ]);
  });
});
