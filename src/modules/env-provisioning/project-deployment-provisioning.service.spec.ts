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
            projectName: 'orders-api-uat',
            branchName: 'uat',
            rootDirectory: '.',
            buildCommand: 'npm ci && npm run build',
            startCommand: 'npm run start:prod',
            renderRuntime: 'python',
            env: [
              {
                environment: 'uat',
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
        environment: 'uat',
        vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
      },
    );
    expect(JSON.stringify(result)).not.toContain('postgres://secret');
    expect(result.status).toBe('completed');
  });

  it('fans out variable group env vars and lets target-specific vars override them', async () => {
    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
      vercelCiSecretsService as never,
    );

    await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      request: {
        enabled: true,
        variableGroups: [
          {
            name: 'Shared API',
            provider: 'render',
            appliesTo: 'all',
            env: [
              {
                environment: 'uat',
                vars: [
                  { key: 'API_URL', value: 'https://shared.example.com' },
                  { key: 'LOG_LEVEL', value: 'debug' },
                ],
              },
            ],
          },
        ],
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-uat',
            branchName: 'uat',
            env: [
              {
                environment: 'uat',
                vars: [{ key: 'API_URL', value: 'https://branch.example.com' }],
              },
            ],
          },
        ],
      },
    });

    expect(envVarsService.provisionEnvVars).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      {
        deploymentTargetId: 'target-1',
        environment: 'uat',
        vars: [
          { key: 'API_URL', value: 'https://branch.example.com' },
          { key: 'LOG_LEVEL', value: 'debug' },
        ],
      },
    );
  });

  it('can apply a variable group to a selected Vercel target branch', async () => {
    deploymentTargetsService.createDeploymentTarget
      .mockResolvedValueOnce({
        id: 'target-backend-uat',
        provider: 'render',
        providerProjectId: 'srv-1',
        providerProjectName: 'orders-api-uat',
      })
      .mockResolvedValueOnce({
        id: 'target-backend-main',
        provider: 'render',
        providerProjectId: 'srv-2',
        providerProjectName: 'orders-api-main',
      })
      .mockResolvedValueOnce({
        id: 'target-frontend',
        provider: 'vercel',
        providerProjectId: 'prj_1',
        providerProjectName: 'orders-web-test',
      });
    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
      vercelCiSecretsService as never,
    );

    await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders',
      request: {
        enabled: true,
        variableGroups: [
          {
            name: 'Frontend public env',
            provider: 'vercel',
            appliesTo: 'selected',
            targetBranches: ['frontend:vercel:uat'],
            env: [
              {
                environment: 'uat',
                vars: [
                  {
                    key: 'NEXT_PUBLIC_API_URL',
                    value: 'https://api.example.com',
                  },
                ],
              },
            ],
          },
        ],
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-uat',
            branchName: 'uat',
          },
          {
            slot: 'frontend',
            provider: 'vercel',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-web-uat',
            branchName: 'uat',
          },
        ],
      },
    });

    expect(envVarsService.provisionEnvVars).toHaveBeenCalledTimes(1);
    expect(envVarsService.provisionEnvVars).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      {
        deploymentTargetId: 'target-frontend',
        environment: 'uat',
        vars: [
          {
            key: 'NEXT_PUBLIC_API_URL',
            value: 'https://api.example.com',
          },
        ],
      },
    );
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
    expect(
      result.targets.find((target) => target.status === 'failed')?.errorSummary,
    ).toContain('Bearer [redacted]');
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
      providerProjectName: 'orders-ui-uat',
      repoFullName: 'tone/orders-ui',
      branchName: 'uat',
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
      deploymentTargetsService.createDeploymentTarget,
    ).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      expect.objectContaining({
        branchName: 'uat',
        projectName: 'orders-ui-uat',
      }),
    );
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
