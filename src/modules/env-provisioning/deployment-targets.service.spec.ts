import { BadRequestException } from '@nestjs/common';

import { DeploymentStrategyResolver } from './deployment-strategy.resolver';
import { DeploymentTargetsService } from './deployment-targets.service';

describe('DeploymentTargetsService', () => {
  const projectsRepository = {
    findByIdAndUser: jest.fn(),
  };
  const deploymentTargetsRepository = {
    createDeploymentTarget: jest.fn(),
    listDeploymentTargets: jest.fn(),
    updateProviderMetadata: jest.fn(),
  };
  const providerConnectionsRepository = {
    findActiveProviderConnection: jest.fn(),
  };
  const encryptionService = {
    decrypt: jest.fn(),
  };
  const vercelClient = {
    createTarget: jest.fn(),
  };
  const clientRegistry = {
    getClient: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  let service: DeploymentTargetsService;

  beforeEach(() => {
    jest.clearAllMocks();
    projectsRepository.findByIdAndUser.mockResolvedValue({
      id: 'project-1',
      repo_full_name: 'owner/repo',
    });
    providerConnectionsRepository.findActiveProviderConnection.mockResolvedValue(
      {
        id: 'connection-1',
        provider: 'vercel',
        encryptedToken: 'encrypted',
        metadata: {},
      },
    );
    encryptionService.decrypt.mockReturnValue('vercel-token');
    clientRegistry.getClient.mockReturnValue(vercelClient);
    configService.getOrThrow.mockReturnValue({
      envProvisioning: {
        flowciManaged: {
          renderToken: 'render-token',
          vercelToken: 'flowci-vercel-token',
          vercelTeamId: 'team_flowci',
          vercelTeamSlug: 'flowci-team',
        },
      },
    });

    service = new DeploymentTargetsService(
      projectsRepository as never,
      deploymentTargetsRepository as never,
      providerConnectionsRepository as never,
      encryptionService as never,
      clientRegistry as never,
      configService as never,
      new DeploymentStrategyResolver(),
    );
  });

  it('rejects BYO Vercel targets when connection org metadata is missing', async () => {
    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'frontend',
        ownershipMode: 'byo',
        provider: 'vercel',
        providerConnectionId: 'connection-1',
        projectName: 'demo-frontend',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'frontend',
        ownershipMode: 'byo',
        provider: 'vercel',
        providerConnectionId: 'connection-1',
        projectName: 'demo-frontend',
      }),
    ).rejects.toThrow('Vercel provider connection is missing org metadata');
    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).not.toHaveBeenCalled();
  });

  it('creates FlowCI-managed Vercel targets as CI-pushed projects in the managed team', async () => {
    vercelClient.createTarget.mockResolvedValueOnce({
      id: 'prj_1',
      name: 'demo-frontend',
      provider: 'vercel',
      metadata: {
        deploymentStrategy: 'vercel_ci_pushed',
        vercelOrgId: 'team_flowci',
        vercelProjectId: 'prj_1',
        vercelTeamId: 'team_flowci',
        gitConnected: false,
      },
    });
    deploymentTargetsRepository.createDeploymentTarget.mockResolvedValueOnce({
      id: 'target-1',
    });

    await service.createDeploymentTarget('project-1', 'user-1', {
      action: 'create',
      slot: 'frontend',
      ownershipMode: 'flowci_managed',
      provider: 'vercel',
      projectName: 'demo-frontend',
    });

    expect(vercelClient.createTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'flowci-vercel-token',
        deploymentStrategy: 'vercel_ci_pushed',
        vercelOrgId: 'team_flowci',
        vercelTeamId: 'team_flowci',
        vercelTeamSlug: 'flowci-team',
      }),
    );
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ownershipMode: 'flowci_managed',
        provider: 'vercel',
        deploymentStrategy: 'vercel_ci_pushed',
        providerConnectionId: null,
      }),
    );
  });

  it('rejects FlowCI-managed Vercel targets when the managed team id is missing', async () => {
    configService.getOrThrow.mockReturnValue({
      envProvisioning: {
        flowciManaged: {
          renderToken: 'render-token',
          vercelToken: 'flowci-vercel-token',
          vercelTeamId: null,
          vercelTeamSlug: 'flowci-team',
        },
      },
    });

    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'frontend',
        ownershipMode: 'flowci_managed',
        provider: 'vercel',
        projectName: 'demo-frontend',
      }),
    ).rejects.toThrow('FLOWCI_VERCEL_TEAM_ID is required');

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).not.toHaveBeenCalled();
  });
});
