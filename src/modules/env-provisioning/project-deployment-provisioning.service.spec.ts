import { ProjectDeploymentProvisioningService } from './project-deployment-provisioning.service';

describe('ProjectDeploymentProvisioningService', () => {
  const deploymentTargetsService = {
    createDeploymentTarget: jest.fn(),
    updateProviderMetadata: jest.fn(),
  };
  const envVarsService = {
    provisionEnvVars: jest.fn(),
  };
  const vercelCiSecretsService = {
    installForTarget: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deploymentTargetsService.createDeploymentTarget.mockResolvedValue({
      id: 'target-1',
      provider: 'render',
      providerProjectId: 'srv-1',
      providerProjectName: 'orders-api-test',
    });
    envVarsService.provisionEnvVars.mockResolvedValue({
      provisioned: [{ key: 'DATABASE_URL', status: 'provisioned' }],
      failed: [],
    });
    vercelCiSecretsService.installForTarget.mockResolvedValue({
      githubSecrets: {
        token: 'VERCEL_FRONTEND_TOKEN',
        orgId: 'VERCEL_FRONTEND_ORG_ID',
        projectId: 'VERCEL_FRONTEND_PROJECT_ID',
      },
    });
  });

  it('creates provider targets and provisions env vars without storing values in the result', async () => {
    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
      vercelCiSecretsService as never,
    );

    const result = await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      request: {
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
            branchName: 'test',
            rootDirectory: '.',
            buildCommand: 'npm ci && npm run build',
            startCommand: 'npm run start:prod',
            renderRuntime: 'python',
            env: [
              {
                environment: 'test',
                vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
              },
            ],
          },
        ],
      },
    });

    expect(
      deploymentTargetsService.createDeploymentTarget,
    ).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      expect.objectContaining({
        action: 'create',
        provider: 'render',
        renderRuntime: 'python',
        slot: 'backend',
      }),
    );
    expect(envVarsService.provisionEnvVars).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      {
        deploymentTargetId: 'target-1',
        environment: 'test',
        vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
      },
    );
    expect(JSON.stringify(result)).not.toContain('postgres://secret');
    expect(result.status).toBe('completed');
  });

  it('reports partial status when one requested target fails', async () => {
    deploymentTargetsService.createDeploymentTarget
      .mockResolvedValueOnce({
        id: 'target-1',
        provider: 'render',
        providerProjectId: 'srv-1',
        providerProjectName: 'orders-api-test',
      })
      .mockRejectedValueOnce(new Error('Bearer rnd_secret failed'));

    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
      vercelCiSecretsService as never,
    );

    const result = await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      request: {
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
          },
          {
            slot: 'frontend',
            provider: 'vercel',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-web-test',
          },
        ],
      },
    });

    expect(result.status).toBe('partial');
    expect(result.targets[1]?.errorSummary).toContain('Bearer [redacted]');
    expect(JSON.stringify(result)).not.toContain('rnd_secret');
  });

  it('installs GitHub Actions secrets for managed Vercel CI-pushed targets', async () => {
    deploymentTargetsService.createDeploymentTarget.mockResolvedValueOnce({
      id: 'target-1',
      projectId: 'project-1',
      slot: 'frontend',
      ownershipMode: 'flowci_managed',
      provider: 'vercel',
      providerConnectionId: null,
      providerProjectId: 'prj_1',
      providerProjectName: 'orders-ui-test',
      repoFullName: 'tone/orders-ui',
      branchName: 'test',
      rootDirectory: '.',
      buildCommand: 'npm run build',
      startCommand: null,
      environmentMap: {},
      deploymentStrategy: 'vercel_ci_pushed',
      providerMetadata: { vercelOrgId: 'team_flowci' },
      status: 'active',
    });
    deploymentTargetsService.updateProviderMetadata.mockResolvedValueOnce(
      undefined,
    );

    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
      vercelCiSecretsService as never,
    );

    const result = await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-ui',
      githubAccessToken: 'github-token',
      request: {
        enabled: true,
        targets: [
          {
            slot: 'frontend',
            provider: 'vercel',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-ui-test',
            branchName: 'test',
            rootDirectory: '.',
            buildCommand: 'npm run build',
            env: [],
          },
        ],
      },
    });

    expect(vercelCiSecretsService.installForTarget).toHaveBeenCalledWith({
      githubAccessToken: 'github-token',
      repoFullName: 'tone/orders-ui',
      userId: 'user-1',
      providerConnectionId: null,
      target: expect.objectContaining({
        provider: 'vercel',
        ownershipMode: 'flowci_managed',
        deploymentStrategy: 'vercel_ci_pushed',
      }) as unknown,
    });
    expect(
      deploymentTargetsService.updateProviderMetadata,
    ).toHaveBeenCalledWith('target-1', {
      vercelOrgId: 'team_flowci',
      githubSecrets: {
        token: 'VERCEL_FRONTEND_TOKEN',
        orgId: 'VERCEL_FRONTEND_ORG_ID',
        projectId: 'VERCEL_FRONTEND_PROJECT_ID',
      },
    });
    expect(result.targets[0]?.providerMetadata).toEqual({
      vercelOrgId: 'team_flowci',
      githubSecrets: {
        token: 'VERCEL_FRONTEND_TOKEN',
        orgId: 'VERCEL_FRONTEND_ORG_ID',
        projectId: 'VERCEL_FRONTEND_PROJECT_ID',
      },
    });
  });
});
