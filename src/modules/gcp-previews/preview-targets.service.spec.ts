import { PreviewLimitsService } from './preview-limits.service';
import { PreviewTargetsService } from './preview-targets.service';

describe('PreviewTargetsService', () => {
  const orchestrator = {
    provisionTarget: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator.provisionTarget.mockResolvedValue({
      jobId: 'job-1',
      status: 'succeeded',
      runtimePlacement: 'shared',
      serviceUrl: 'https://ac-customer-alpha-pr-42-web-uc.a.run.app',
    });
  });

  it('plans a pull request preview with deterministic service and domain names', async () => {
    const service = new PreviewTargetsService(
      new PreviewLimitsService(),
      orchestrator as never,
    );

    const result = await service.planPullRequestPreview({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      customerSlug: 'Customer One',
      appSlug: 'Alpha Demo',
      serviceSlot: 'web',
      repositoryFullName: 'alpha/demo',
      pullRequestNumber: 42,
      sourceBranch: 'Feature/Unsafe Raw Name',
      commitSha: 'abcdef1234567890',
      managedDomainBase: 'itsandbox.site',
      planTier: 'production_business',
      activePreviewCount: 0,
      forkPullRequest: false,
      usesProductionSecrets: false,
      sharedProjectId: 'alphaci-shared-dev',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
    });

    expect(result.cloudRunServiceName).toBe(
      'ac-customer-one-alpha-demo-pr-42-web',
    );
    expect(result.previewDomain).toBe(
      'pr-42-alpha-demo-customer-one.itsandbox.site',
    );
    expect(result.sourceBranchHash).toMatch(/^[a-f0-9]{12}$/);
    expect(result.labels).toEqual(
      expect.objectContaining({
        environment: 'preview',
        pullRequestNumber: '42',
        projectId: 'project-1',
      }),
    );
    expect(result.lifecycleStatus).toBe('requested');
  });

  it('calls the GCP provisioning orchestrator with preview-safe values', async () => {
    const service = new PreviewTargetsService(
      new PreviewLimitsService(),
      orchestrator as never,
    );

    await service.planPullRequestPreview({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      customerSlug: 'customer-one',
      appSlug: 'alpha-demo',
      serviceSlot: 'api',
      repositoryFullName: 'alpha/demo',
      pullRequestNumber: 42,
      sourceBranch: 'feature/payments',
      commitSha: 'abcdef1234567890',
      managedDomainBase: 'itsandbox.site',
      planTier: 'production_business',
      activePreviewCount: 0,
      forkPullRequest: false,
      usesProductionSecrets: false,
      sharedProjectId: 'alphaci-shared-dev',
      artifactRegistryRepository: 'alphaci',
      region: 'asia-southeast1',
    });

    expect(orchestrator.provisionTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'preview',
        serviceName: 'ac-customer-one-alpha-demo-pr-42-api',
        imageName: 'preview-alpha-demo-pr-42',
        runtimePlacement: 'shared',
        idempotencyKey: 'preview:workspace-1:project-1:42:api',
        correlationId: 'preview-project-1-pr-42-api',
      }),
    );
  });

  it('blocks fork previews before provisioning', async () => {
    const service = new PreviewTargetsService(
      new PreviewLimitsService(),
      orchestrator as never,
    );

    await expect(
      service.planPullRequestPreview({
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        deploymentTargetId: 'target-1',
        customerSlug: 'customer-one',
        appSlug: 'alpha-demo',
        serviceSlot: 'web',
        repositoryFullName: 'alpha/demo',
        pullRequestNumber: 42,
        sourceBranch: 'feature/payments',
        commitSha: 'abcdef1234567890',
        managedDomainBase: 'itsandbox.site',
        planTier: 'production_business',
        activePreviewCount: 0,
        forkPullRequest: true,
        usesProductionSecrets: false,
        sharedProjectId: 'alphaci-shared-dev',
        artifactRegistryRepository: 'alphaci',
        region: 'asia-southeast1',
      }),
    ).rejects.toThrow('Preview deployment is not allowed');
    expect(orchestrator.provisionTarget).not.toHaveBeenCalled();
  });
});
