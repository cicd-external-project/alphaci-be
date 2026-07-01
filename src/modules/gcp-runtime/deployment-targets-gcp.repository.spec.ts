import { BadRequestException } from '@nestjs/common';

import { GcpDeploymentTargetsRepository } from './deployment-targets-gcp.repository';

describe('GcpDeploymentTargetsRepository', () => {
  const databaseService = {
    query: jest.fn(),
  };

  let repository: GcpDeploymentTargetsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new GcpDeploymentTargetsRepository(databaseService as never);
  });

  it('creates shared-project GCP deployment target metadata without provider connection fields', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'target-1',
          workspace_id: 'workspace-1',
          project_id: 'project-1',
          runtime_scope: 'shared_project',
          provider: 'gcp',
          deployment_strategy: 'gcp_cloud_run',
          gcp_project_id: 'alphaci-runtime',
          cloud_run_service_name: 'orders-api-dev',
        }),
      ],
    });

    const target = await repository.createDeploymentTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      ownerType: 'alphaci_customer',
      runtimeScope: 'shared_project',
      customerSlug: 'customer-a',
      appSlug: 'orders-api',
      environment: 'dev',
      serviceSlot: 'api',
      gcpProjectId: 'alphaci-runtime',
      region: 'asia-southeast1',
      artifactRegistryLocation: 'asia-southeast1',
      artifactRegistryRepo: 'shared-services',
      imageName: 'orders-api',
      cloudRunServiceName: 'orders-api-dev',
      runtimeServiceAccount: 'runtime@alphaci-runtime.iam.gserviceaccount.com',
      deployerServiceAccount:
        'deployer@alphaci-runtime.iam.gserviceaccount.com',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'INSERT INTO runtime_deployments.deployment_targets',
      ),
      expect.arrayContaining([
        'workspace-1',
        'project-1',
        'alphaci_customer',
        'shared_project',
        null,
        'customer-a',
        'orders-api',
        'dev',
        'api',
        'alphaci-runtime',
      ]),
    );
    expect(JSON.stringify(databaseService.query.mock.calls[0])).not.toContain(
      'provider_connection',
    );
    expect(target).toEqual(
      expect.objectContaining({
        id: 'target-1',
        runtimeScope: 'shared_project',
        provider: 'gcp',
        deploymentStrategy: 'gcp_cloud_run',
      }),
    );
  });

  it('rejects missing required GCP target fields before querying', async () => {
    await expect(
      repository.createDeploymentTarget({
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        ownerType: 'alphaci_customer',
        runtimeScope: 'shared_project',
        customerSlug: 'customer-a',
        appSlug: 'orders-api',
        environment: 'dev',
        serviceSlot: 'api',
        gcpProjectId: '',
        region: 'asia-southeast1',
        artifactRegistryLocation: 'asia-southeast1',
        artifactRegistryRepo: 'shared-services',
        imageName: 'orders-api',
        cloudRunServiceName: 'orders-api-dev',
        runtimeServiceAccount:
          'runtime@alphaci-runtime.iam.gserviceaccount.com',
        deployerServiceAccount:
          'deployer@alphaci-runtime.iam.gserviceaccount.com',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(databaseService.query).not.toHaveBeenCalled();
  });

  it('finds a target by workspace, project, environment, and service slot', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'target-1',
          workspace_id: 'workspace-1',
          project_id: 'project-1',
          environment: 'prod',
          service_slot: 'web',
        }),
      ],
    });

    const target = await repository.findDeploymentTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      environment: 'prod',
      serviceSlot: 'web',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE workspace_id = $1'),
      ['workspace-1', 'project-1', 'prod', 'web'],
    );
    expect(target).toEqual(
      expect.objectContaining({
        id: 'target-1',
        environment: 'prod',
        serviceSlot: 'web',
      }),
    );
  });
  it('records reconciliation evidence without changing provider secrets', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'target-1',
          deployment_status: 'healthy',
          last_healthy_revision: 'alpha-demo-dev-00001-fake',
          metadata: {
            reconciliation: {
              status: 'ready',
              lastObservedUrl: 'https://alpha-demo-dev-uc.a.run.app',
            },
          },
        }),
      ],
    });

    const target = await repository.recordReconciliationEvidence({
      targetId: 'target-1',
      status: 'ready',
      deploymentStatus: 'healthy',
      lastCheckedAt: '2026-07-02T00:00:00.000Z',
      lastObservedRevision: 'alpha-demo-dev-00001-fake',
      lastObservedUrl: 'https://alpha-demo-dev-uc.a.run.app',
      correlationId: 'corr-1',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('last_healthy_revision = $2'),
      expect.arrayContaining([
        'target-1',
        'alpha-demo-dev-00001-fake',
        null,
        null,
      ]),
    );
    expect(JSON.stringify(databaseService.query.mock.calls[0])).not.toContain(
      'secret',
    );
    expect(target).toEqual(
      expect.objectContaining({
        id: 'target-1',
        deploymentStatus: 'healthy',
        lastHealthyRevision: 'alpha-demo-dev-00001-fake',
      }),
    );
  });
  it('never maps secret payload fields into target summaries', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          ...makeRow({ id: 'target-1' }),
          secret_value: 'postgres://secret',
          database_url_plaintext: 'postgres://secret',
          provider_token_plaintext: 'token',
        },
      ],
    });

    const target = await repository.findDeploymentTarget({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      environment: 'dev',
      serviceSlot: 'api',
    });

    expect(JSON.stringify(target)).not.toContain('postgres://secret');
    expect(JSON.stringify(target)).not.toContain('token');
  });
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    owner_type: 'alphaci_customer',
    runtime_scope: 'shared_project',
    product_slug: null,
    customer_slug: 'customer-a',
    app_slug: 'orders-api',
    environment: 'dev',
    service_slot: 'api',
    provider: 'gcp',
    deployment_strategy: 'gcp_cloud_run',
    gcp_project_id: 'alphaci-runtime',
    gcp_project_number: null,
    region: 'asia-southeast1',
    artifact_registry_location: 'asia-southeast1',
    artifact_registry_repo: 'shared-services',
    image_name: 'orders-api',
    cloud_run_service_name: 'orders-api-dev',
    runtime_service_account: 'runtime@alphaci-runtime.iam.gserviceaccount.com',
    deployer_service_account:
      'deployer@alphaci-runtime.iam.gserviceaccount.com',
    provisioning_status: 'pending',
    deployment_status: 'idle',
    last_healthy_revision: null,
    last_deployment_error_code: null,
    last_deployment_error_safe_message: null,
    metadata: {},
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}
