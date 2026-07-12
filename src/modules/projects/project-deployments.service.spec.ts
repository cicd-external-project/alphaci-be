import { ProjectDeploymentsService } from './project-deployments.service';

describe('ProjectDeploymentsService', () => {
  const projectsRepository = {
    findByIdAndUser: jest.fn(),
  };
  const deploymentTargetsRepository = {
    listDeploymentTargets: jest.fn(),
  };
  const provider = {
    listDeployments: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    projectsRepository.findByIdAndUser.mockResolvedValue({
      id: 'project-1',
      repo_full_name: 'tone/orders-api',
    });
    deploymentTargetsRepository.listDeploymentTargets.mockResolvedValue([]);
    provider.listDeployments.mockResolvedValue([]);
    configService.getOrThrow.mockReturnValue({
      deploymentHistory: {
        enabled: true,
        liveProvidersEnabled: false,
      },
    });
  });

  function createService() {
    return new ProjectDeploymentsService(
      projectsRepository as never,
      deploymentTargetsRepository as never,
      provider as never,
      configService as never,
    );
  }

  it('handles empty deployment history without provider credentials', async () => {
    await expect(
      createService().listDeployments('project-1', 'user-1'),
    ).resolves.toEqual({
      enabled: true,
      mode: 'local_mock',
      liveProvidersEnabled: false,
      deployments: [],
    });

    expect(provider.listDeployments).toHaveBeenCalledWith([]);
  });

  it('returns local deployment history from stored targets', async () => {
    const targets = [
      {
        id: 'target-render',
        provider: 'render',
        providerProjectId: 'srv-1',
        providerProjectName: 'orders-api-test',
        branchName: 'test',
        renderEnvironmentName: 'test',
        providerMetadata: {},
      },
    ];
    deploymentTargetsRepository.listDeploymentTargets.mockResolvedValueOnce(
      targets,
    );
    provider.listDeployments.mockResolvedValueOnce([
      {
        id: 'local-target-render',
        targetId: 'target-render',
        targetName: 'orders-api-test',
        provider: 'render',
        environment: 'test',
        branch: 'test',
        commitSha: null,
        status: 'ready',
        createdAt: '2026-06-12T00:00:00.000Z',
        readyAt: '2026-06-12T00:05:00.000Z',
        providerUrl: 'https://dashboard.render.com/web/srv-1',
        consoleUrl: 'https://dashboard.render.com/web/srv-1/logs',
      },
    ]);

    await expect(
      createService().listDeployments('project-1', 'user-1'),
    ).resolves.toMatchObject({
      deployments: [
        {
          id: 'local-target-render',
          provider: 'render',
          status: 'ready',
        },
      ],
    });
    expect(provider.listDeployments).toHaveBeenCalledWith(targets);
  });

  it('returns disabled local state when deployment history is off', async () => {
    configService.getOrThrow.mockReturnValueOnce({
      deploymentHistory: {
        enabled: false,
        liveProvidersEnabled: false,
      },
    });

    await expect(
      createService().listDeployments('project-1', 'user-1'),
    ).resolves.toMatchObject({
      enabled: false,
      deployments: [],
    });
    expect(provider.listDeployments).not.toHaveBeenCalled();
  });

  it('reports liveProvidersEnabled true when explicitly configured', async () => {
    configService.getOrThrow.mockReturnValue({
      deploymentHistory: {
        enabled: true,
        liveProvidersEnabled: true,
      },
    });

    await expect(
      createService().listDeployments('project-1', 'user-1'),
    ).resolves.toMatchObject({
      liveProvidersEnabled: true,
    });
  });

  it('reports liveProvidersEnabled false when explicitly disabled', async () => {
    configService.getOrThrow.mockReturnValue({
      deploymentHistory: {
        enabled: true,
        liveProvidersEnabled: false,
      },
    });

    await expect(
      createService().listDeployments('project-1', 'user-1'),
    ).resolves.toMatchObject({
      liveProvidersEnabled: false,
    });
  });

  it('defaults liveProvidersEnabled to true when configService is absent', async () => {
    const service = new ProjectDeploymentsService(
      projectsRepository as never,
      deploymentTargetsRepository as never,
      provider as never,
    );

    await expect(
      service.listDeployments('project-1', 'user-1'),
    ).resolves.toMatchObject({
      liveProvidersEnabled: true,
    });
  });
});
