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
});
