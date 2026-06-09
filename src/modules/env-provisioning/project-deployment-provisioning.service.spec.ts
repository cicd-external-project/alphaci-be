import { ProjectDeploymentProvisioningService } from './project-deployment-provisioning.service';

describe('ProjectDeploymentProvisioningService', () => {
  const deploymentTargetsService = {
    createDeploymentTarget: jest.fn(),
  };
  const envVarsService = {
    provisionEnvVars: jest.fn(),
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
  });

  it('creates provider targets and provisions env vars without storing values in the result', async () => {
    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
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
});
