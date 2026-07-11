import { GcpProvisioningOrchestratorService } from './gcp-provisioning-orchestrator.service';
import { FakeGcpRuntimeAdapter } from './fake-gcp-runtime.adapter';
import type { ProvisioningJobSummary } from './gcp-control.types';

function makeJob(
  overrides: Partial<ProvisioningJobSummary> = {},
): ProvisioningJobSummary {
  return {
    id: 'job-1',
    jobType: 'provision_target',
    idempotencyKey: 'workspace-1:project-1:target-1:dev',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    deploymentTargetId: 'target-1',
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 5,
    lockedAt: null,
    lockedBy: null,
    nextRetryAt: null,
    deadLetterReason: null,
    safeErrorCode: null,
    safeErrorMessage: null,
    payload: {},
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('GcpProvisioningOrchestratorService', () => {
  const repository = {
    findByIdempotencyKey: jest.fn(),
    createJob: jest.fn(),
    markSucceeded: jest.fn(),
    markRetryableFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByIdempotencyKey.mockResolvedValue(null);
    repository.createJob.mockResolvedValue(makeJob());
    repository.markSucceeded.mockImplementation(
      (id: string, payload: Record<string, unknown>) =>
        Promise.resolve(
          makeJob({ id, status: 'succeeded', payload: { result: payload } }),
        ),
    );
    repository.markRetryableFailure.mockImplementation(
      (id: string, error: { code: string; safeMessage: string }) =>
        Promise.resolve(
          makeJob({
            id,
            status: 'failed',
            safeErrorCode: error.code,
            safeErrorMessage: error.safeMessage,
          }),
        ),
    );
  });

  it('provisions a shared runtime target through the fake adapter and stores safe outputs', async () => {
    const adapter = new FakeGcpRuntimeAdapter();
    const service = new GcpProvisioningOrchestratorService(
      repository as never,
      adapter,
    );

    const result = await service.provisionTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      projectSlug: 'alpha-demo',
      environment: 'dev',
      serviceName: 'alpha-demo-dev',
      imageName: 'alpha-demo',
      runtimePlacement: 'shared',
      sharedProjectId: 'alphaci-shared-dev',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
      correlationId: 'corr-1',
    });

    expect(repository.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'provision_target',
        idempotencyKey: 'workspace-1:project-1:target-1:dev',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        deploymentTargetId: 'target-1',
      }),
    );
    expect(repository.markSucceeded).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        gcpProjectId: 'alphaci-shared-dev',
        artifactRegistryRepository:
          'asia-southeast1-docker.pkg.dev/alphaci-shared-dev/alphaci',
        serviceUrl: 'https://alpha-demo-dev-uc.a.run.app',
        correlationId: 'corr-1',
      }),
    );
    expect(adapter.calls.map((call) => call.operation)).toEqual([
      'ensureProject',
      'ensureArtifactRegistry',
      'ensureRuntimeServiceAccount',
      'ensureCloudRunService',
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        gcpProjectId: 'alphaci-shared-dev',
        serviceUrl: 'https://alpha-demo-dev-uc.a.run.app',
        runtimePlacement: 'shared',
      }),
    );
  });

  it('returns an existing idempotent job without calling the adapter', async () => {
    repository.findByIdempotencyKey.mockResolvedValueOnce(
      makeJob({
        id: 'job-existing',
        status: 'succeeded',
        payload: {
          result: {
            gcpProjectId: 'alphaci-shared-dev',
            serviceUrl: 'https://alpha-demo-dev-uc.a.run.app',
            runtimePlacement: 'shared',
          },
        },
      }),
    );
    const adapter = new FakeGcpRuntimeAdapter();
    const service = new GcpProvisioningOrchestratorService(
      repository as never,
      adapter,
    );

    const result = await service.provisionTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      projectSlug: 'alpha-demo',
      environment: 'dev',
      serviceName: 'alpha-demo-dev',
      runtimePlacement: 'shared',
      sharedProjectId: 'alphaci-shared-dev',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
    });

    expect(repository.createJob).not.toHaveBeenCalled();
    expect(adapter.calls).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        jobId: 'job-existing',
        status: 'succeeded',
        serviceUrl: 'https://alpha-demo-dev-uc.a.run.app',
      }),
    );
  });

  it('records dedicated project intent without adapter calls until approval is granted', async () => {
    const adapter = new FakeGcpRuntimeAdapter();
    const service = new GcpProvisioningOrchestratorService(
      repository as never,
      adapter,
    );

    const result = await service.provisionTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      projectSlug: 'alpha-demo',
      environment: 'prod',
      serviceName: 'alpha-demo',
      runtimePlacement: 'dedicated',
      sharedProjectId: 'alphaci-shared-prod',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
      dedicatedProjectId: 'alphaci-cust-123-prod',
      dedicatedProjectApproved: false,
    });

    expect(repository.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          runtimePlacement: 'dedicated',
          dedicatedProjectIntent: {
            gcpProjectId: 'alphaci-cust-123-prod',
            approvalRequired: true,
          },
        }),
      }),
    );
    expect(adapter.calls).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'pending_approval',
        runtimePlacement: 'dedicated',
        gcpProjectId: 'alphaci-cust-123-prod',
      }),
    );
  });

  it('marks adapter failures as retryable without exposing raw error details', async () => {
    const adapter = new FakeGcpRuntimeAdapter({
      failOperation: 'ensureCloudRunService',
      errorCode: 'GCP_CLOUD_RUN_DEPLOY_FAILED',
      safeMessage: 'Cloud Run service could not be prepared',
    });
    const service = new GcpProvisioningOrchestratorService(
      repository as never,
      adapter,
    );

    const result = await service.provisionTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      projectSlug: 'alpha-demo',
      environment: 'dev',
      serviceName: 'alpha-demo-dev',
      runtimePlacement: 'shared',
      sharedProjectId: 'alphaci-shared-dev',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
      correlationId: 'corr-failed',
    });

    expect(repository.markRetryableFailure).toHaveBeenCalledWith('job-1', {
      code: 'GCP_CLOUD_RUN_DEPLOY_FAILED',
      safeMessage: 'Cloud Run service could not be prepared',
      nextRetryAt: expect.any(String),
    });
    expect(
      JSON.stringify(repository.markRetryableFailure.mock.calls),
    ).not.toContain('private_key');
    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        safeErrorCode: 'GCP_CLOUD_RUN_DEPLOY_FAILED',
        correlationId: 'corr-failed',
      }),
    );
  });
});
