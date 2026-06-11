import { BadRequestException } from '@nestjs/common';

import { VercelCiSecretsService } from './vercel-ci-secrets.service';

describe('VercelCiSecretsService', () => {
  const githubService = {
    setActionsSecretStrict: jest.fn(),
  };
  const providerConnectionsRepository = {
    findActiveProviderConnection: jest.fn(),
  };
  const encryptionService = {
    decrypt: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    providerConnectionsRepository.findActiveProviderConnection.mockResolvedValue(
      {
        provider: 'vercel',
        encryptedToken: 'encrypted-vercel-token',
      },
    );
    encryptionService.decrypt.mockReturnValue('plain-vercel-token');
  });

  it('installs per-slot Vercel secrets for CI-pushed targets', async () => {
    const service = new VercelCiSecretsService(
      githubService as never,
      providerConnectionsRepository as never,
      encryptionService as never,
    );

    const result = await service.installForTarget({
      githubAccessToken: 'github-token',
      repoFullName: 'owner/web',
      userId: 'user-1',
      providerConnectionId: 'connection-1',
      target: {
        id: 'target-1',
        projectId: 'project-1',
        slot: 'frontend',
        ownershipMode: 'byo',
        provider: 'vercel',
        providerConnectionId: 'connection-1',
        providerProjectId: 'prj_1',
        providerProjectName: 'web',
        repoFullName: 'owner/web',
        branchName: 'test',
        rootDirectory: null,
        buildCommand: null,
        startCommand: null,
        environmentMap: {},
        deploymentStrategy: 'vercel_ci_pushed',
        providerMetadata: { vercelOrgId: 'user_123' },
        status: 'active',
      },
    });

    expect(result.githubSecrets).toEqual({
      token: 'VERCEL_FRONTEND_TOKEN',
      orgId: 'VERCEL_FRONTEND_ORG_ID',
      projectId: 'VERCEL_FRONTEND_PROJECT_ID',
    });
    expect(githubService.setActionsSecretStrict).toHaveBeenCalledTimes(3);
    expect(githubService.setActionsSecretStrict).toHaveBeenCalledWith(
      'github-token',
      'owner',
      'web',
      'VERCEL_FRONTEND_TOKEN',
      'plain-vercel-token',
    );
    expect(githubService.setActionsSecretStrict).toHaveBeenCalledWith(
      'github-token',
      'owner',
      'web',
      'VERCEL_FRONTEND_ORG_ID',
      'user_123',
    );
    expect(githubService.setActionsSecretStrict).toHaveBeenCalledWith(
      'github-token',
      'owner',
      'web',
      'VERCEL_FRONTEND_PROJECT_ID',
      'prj_1',
    );
  });

  it('requires Vercel org metadata before installing secrets', async () => {
    const service = new VercelCiSecretsService(
      githubService as never,
      providerConnectionsRepository as never,
      encryptionService as never,
    );

    await expect(
      service.installForTarget({
        githubAccessToken: 'github-token',
        repoFullName: 'owner/web',
        userId: 'user-1',
        providerConnectionId: 'connection-1',
        target: {
          id: 'target-1',
          projectId: 'project-1',
          slot: 'frontend',
          ownershipMode: 'byo',
          provider: 'vercel',
          providerConnectionId: 'connection-1',
          providerProjectId: 'prj_1',
          providerProjectName: 'web',
          repoFullName: 'owner/web',
          branchName: 'test',
          rootDirectory: null,
          buildCommand: null,
          startCommand: null,
          environmentMap: {},
          deploymentStrategy: 'vercel_ci_pushed',
          providerMetadata: {},
          status: 'active',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
