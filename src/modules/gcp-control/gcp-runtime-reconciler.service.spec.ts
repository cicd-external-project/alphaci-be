import { FakeGcpRuntimeAdapter } from './fake-gcp-runtime.adapter';
import { GcpRuntimeAdapterError } from './gcp-runtime.adapter';
import { GcpRuntimeReconcilerService } from './gcp-runtime-reconciler.service';
import type { GcpDeploymentTargetSummary } from '../gcp-runtime/gcp-runtime.types';

function makeTarget(
  overrides: Partial<GcpDeploymentTargetSummary> = {},
): GcpDeploymentTargetSummary {
  return {
    id: 'target-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    ownerType: 'alphaci_customer',
    runtimeScope: 'shared_project',
    productSlug: null,
    customerSlug: 'customer-a',
    appSlug: 'alpha-demo',
    environment: 'dev',
    serviceSlot: 'api',
    provider: 'gcp',
    deploymentStrategy: 'gcp_cloud_run',
    gcpProjectId: 'alphaci-shared-dev',
    gcpProjectNumber: null,
    region: 'asia-southeast1',
    artifactRegistryLocation: 'asia-southeast1',
    artifactRegistryRepo: 'alphaci',
    imageName: 'alpha-demo',
    cloudRunServiceName: 'alpha-demo-dev',
    runtimeServiceAccount: 'alpha-demo-dev@alphaci-shared-dev.iam.gserviceaccount.com',
    deployerServiceAccount: 'deployer@alphaci-shared-dev.iam.gserviceaccount.com',
    provisioningStatus: 'provisioned',
    deploymentStatus: 'healthy',
    lastHealthyRevision: null,
    lastDeploymentErrorCode: null,
    lastDeploymentErrorSafeMessage: null,
    metadata: {},
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('GcpRuntimeReconcilerService', () => {
  const deploymentTargetsRepository = {
    recordReconciliationEvidence: jest.fn(),
  };
  const provisioningJobsRepository = {
    findByIdempotencyKey: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deploymentTargetsRepository.recordReconciliationEvidence.mockImplementation(
      (input: Record<string, unknown>) => Promise.resolve({ ...makeTarget(), ...input }),
    );
    provisioningJobsRepository.findByIdempotencyKey.mockResolvedValue(null);
  });

  it('marks a target healthy when the fake Cloud Run service exists', async () => {
    const adapter = new FakeGcpRuntimeAdapter();
    const service = new GcpRuntimeReconcilerService(
      deploymentTargetsRepository as never,
      provisioningJobsRepository as never,
      adapter,
    );

    const result = await service.reconcileTarget({
      target: makeTarget(),
      correlationId: 'corr-healthy',
    });

    expect(deploymentTargetsRepository.recordReconciliationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'target-1',
        status: 'ready',
        deploymentStatus: 'healthy',
        lastObservedRevision: 'alpha-demo-dev-00001-fake',
        lastObservedUrl: 'https://alpha-demo-dev-uc.a.run.app',
        correlationId: 'corr-healthy',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        deploymentStatus: 'healthy',
        serviceUrl: 'https://alpha-demo-dev-uc.a.run.app',
      }),
    );
  });

  it('marks a target drifted when the fake Cloud Run service is missing', async () => {
    const adapter = new FakeGcpRuntimeAdapter({
      failOperation: 'getCloudRunService',
      errorCode: 'GCP_CLOUD_RUN_SERVICE_MISSING',
      safeMessage: 'Cloud Run service is missing',
    });
    const service = new GcpRuntimeReconcilerService(
      deploymentTargetsRepository as never,
      provisioningJobsRepository as never,
      adapter,
    );

    const result = await service.reconcileTarget({
      target: makeTarget(),
      correlationId: 'corr-missing',
    });

    expect(deploymentTargetsRepository.recordReconciliationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'target-1',
        status: 'drifted',
        deploymentStatus: 'unhealthy',
        lastErrorCode: 'GCP_CLOUD_RUN_SERVICE_MISSING',
        lastErrorMessage: 'Cloud Run service is missing',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'drifted',
        safeErrorCode: 'GCP_CLOUD_RUN_SERVICE_MISSING',
      }),
    );
  });

  it('marks a target blocked by access on permission errors', async () => {
    const adapter = new FakeGcpRuntimeAdapter({
      failOperation: 'getCloudRunService',
      errorCode: 'GCP_PERMISSION_DENIED',
      safeMessage: 'GCP permission is missing for Cloud Run inspection',
    });
    const service = new GcpRuntimeReconcilerService(
      deploymentTargetsRepository as never,
      provisioningJobsRepository as never,
      adapter,
    );

    const result = await service.reconcileTarget({
      target: makeTarget(),
      correlationId: 'corr-access',
    });

    expect(deploymentTargetsRepository.recordReconciliationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked_by_access',
        deploymentStatus: 'failed',
        lastErrorCode: 'GCP_PERMISSION_DENIED',
      }),
    );
    expect(result.status).toBe('blocked_by_access');
  });

  it('marks a failed target retry pending when a retryable provisioning job exists', async () => {
    provisioningJobsRepository.findByIdempotencyKey.mockResolvedValueOnce({
      id: 'job-1',
      status: 'failed',
      nextRetryAt: '2026-07-02T01:00:00.000Z',
      safeErrorCode: 'GCP_DEPLOY_FAILED',
      safeErrorMessage: 'Cloud Run deployment failed',
    });
    const adapter = {
      getCloudRunService: jest.fn(() => {
        throw new GcpRuntimeAdapterError(
          'GCP_DEPLOY_FAILED',
          'Cloud Run deployment failed',
        );
      }),
    };
    const service = new GcpRuntimeReconcilerService(
      deploymentTargetsRepository as never,
      provisioningJobsRepository as never,
      adapter as never,
    );

    const result = await service.reconcileTarget({
      target: makeTarget({ deploymentStatus: 'failed' }),
      correlationId: 'corr-retry',
    });

    expect(deploymentTargetsRepository.recordReconciliationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retry_pending',
        deploymentStatus: 'queued',
        lastErrorCode: 'GCP_DEPLOY_FAILED',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'retry_pending',
        nextRetryAt: '2026-07-02T01:00:00.000Z',
      }),
    );
  });
});
