import { BadRequestException } from '@nestjs/common';

import { DeploymentStrategyResolver } from './deployment-strategy.resolver';
import { DeploymentTargetsService } from './deployment-targets.service';

describe('DeploymentTargetsService', () => {
  const projectsRepository = {
    findByIdAndUser: jest.fn(),
  };
  const deploymentTargetsRepository = {
    createDeploymentTarget: jest.fn(),
    deleteDeploymentTargetForUser: jest.fn(),
    findDeploymentTargetForUser: jest.fn(),
    listDeploymentTargets: jest.fn(),
    updateDeploymentTargetMetadataForUser: jest.fn(),
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
  const usageQuotaService = {
    assertWithinLimit: jest.fn(),
    assertManagedFleetCapacity: jest.fn(),
  };
  const workspaceAccessService = {
    assertProjectRole: jest.fn(),
  };
  const auditEventsService = {
    recordProjectEvent: jest.fn(),
  };
  const notificationEventsService = {
    record: jest.fn(),
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
    usageQuotaService.assertWithinLimit.mockResolvedValue(undefined);
    usageQuotaService.assertManagedFleetCapacity.mockResolvedValue(undefined);
    workspaceAccessService.assertProjectRole.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'developer',
    });
    configService.getOrThrow.mockReturnValue({
      envProvisioning: {
        ownershipMode: 'byo',
        flowciManaged: {
          renderToken: 'render-token',
          vercelToken: 'flowci-vercel-token',
          vercelTeamId: 'team_flowci',
          vercelTeamSlug: 'flowci-team',
        },
      },
      projectTargetManagement: {
        enabled: true,
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
      undefined,
      usageQuotaService as never,
      workspaceAccessService as never,
      auditEventsService as never,
      notificationEventsService as never,
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

  it('rejects archived alphaCI-managed Vercel targets before provider calls', async () => {
    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'frontend',
        ownershipMode: 'flowci_managed',
        provider: 'vercel',
        projectName: 'demo-frontend',
      }),
    ).rejects.toThrow(
      'Managed vercel hosting is archived. Connect your own vercel account and use BYO hosting for new targets.',
    );

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).not.toHaveBeenCalled();
    expect(workspaceAccessService.assertProjectRole).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      ['owner', 'admin', 'developer'],
    );
  });

  it('rejects archived alphaCI-managed Render targets before provider calls', async () => {
    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'backend',
        ownershipMode: 'flowci_managed',
        provider: 'render',
        projectName: 'demo-backend',
      }),
    ).rejects.toThrow(
      'Managed render hosting is archived. Connect your own render account and use BYO hosting for new targets.',
    );

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).not.toHaveBeenCalled();
  });

  it('rejects BYO targets when the deployment centralizes on flowci_managed', async () => {
    configService.getOrThrow.mockReturnValue({
      envProvisioning: {
        ownershipMode: 'flowci_managed',
        flowciManaged: {
          renderToken: 'render-token',
          vercelToken: 'flowci-vercel-token',
          vercelTeamId: 'team_flowci',
          vercelTeamSlug: 'flowci-team',
        },
      },
      projectTargetManagement: { enabled: true },
    });

    await expect(
      service.createDeploymentTarget('project-1', 'user-1', {
        action: 'create',
        slot: 'frontend',
        ownershipMode: 'byo',
        provider: 'vercel',
        projectName: 'demo-frontend',
        providerConnectionId: 'conn-1',
      }),
    ).rejects.toThrow(
      "This workspace centralizes deployments on the organization's vercel account. Bring-your-own vercel hosting is not available here.",
    );

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).not.toHaveBeenCalled();
  });

  it('registers existing Render services without storing legacy deploy hook metadata', async () => {
    providerConnectionsRepository.findActiveProviderConnection.mockResolvedValueOnce(
      {
        id: 'connection-1',
        provider: 'render',
        encryptedToken: 'encrypted',
        metadata: {
          ownerId: 'usr-render-owner',
        },
      },
    );
    encryptionService.decrypt.mockReturnValueOnce('render-token');
    deploymentTargetsRepository.createDeploymentTarget.mockResolvedValueOnce({
      id: 'target-1',
    });

    await service.createDeploymentTarget('project-1', 'user-1', {
      action: 'register_existing',
      slot: 'backend',
      ownershipMode: 'byo',
      provider: 'render',
      providerConnectionId: 'connection-1',
      providerProjectId: 'srv-1',
      providerProjectName: 'orders-api-test',
      renderDeployMethod: 'existing_service',
      environmentMap: {
        deployHookUrl: 'https://api.render.com/deploy/legacy',
      },
    });

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.createDeploymentTarget,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'render',
        providerConnectionId: 'connection-1',
        providerProjectId: 'srv-1',
        providerProjectName: 'orders-api-test',
        deploymentStrategy: 'render_existing_service',
      }),
    );
    const [createInput] = deploymentTargetsRepository.createDeploymentTarget
      .mock.calls[0] as [
      {
        providerMetadata: Record<string, unknown>;
      },
    ];
    expect(createInput.providerMetadata).not.toHaveProperty('deployHookUrl');
  });

  it('updates alphaCI target metadata without calling provider clients', async () => {
    const updatedTarget = {
      id: 'target-1',
      projectId: 'project-1',
      slot: 'backend',
      provider: 'render',
      providerProjectName: 'orders-api-uat',
      branchName: 'uat',
      rootDirectory: 'apps/api',
      buildCommand: 'npm run build',
      startCommand: 'npm run start:prod',
      renderEnvironmentName: 'uat',
    };
    deploymentTargetsRepository.updateDeploymentTargetMetadataForUser.mockResolvedValueOnce(
      updatedTarget,
    );

    await expect(
      service.updateDeploymentTargetMetadata(
        'project-1',
        'target-1',
        'user-1',
        {
          providerProjectName: ' orders-api-uat ',
          branchName: ' uat ',
          rootDirectory: ' apps/api ',
          buildCommand: ' npm run build ',
          startCommand: ' npm run start:prod ',
          slot: 'backend',
          renderEnvironmentName: 'uat',
        },
      ),
    ).resolves.toEqual(updatedTarget);

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.updateDeploymentTargetMetadataForUser,
    ).toHaveBeenCalledWith(
      'project-1',
      'target-1',
      'user-1',
      expect.objectContaining({
        providerProjectName: 'orders-api-uat',
        branchName: 'uat',
        rootDirectory: 'apps/api',
        buildCommand: 'npm run build',
        startCommand: 'npm run start:prod',
        slot: 'backend',
        renderEnvironmentName: 'uat',
      }),
    );
    expect(workspaceAccessService.assertProjectRole).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      ['owner', 'admin', 'developer'],
    );
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'deployment_target_updated',
      }),
    );
  });

  it('rejects metadata updates for another user target', async () => {
    deploymentTargetsRepository.updateDeploymentTargetMetadataForUser.mockResolvedValueOnce(
      null,
    );

    await expect(
      service.updateDeploymentTargetMetadata(
        'project-1',
        'target-1',
        'user-2',
        {
          providerProjectName: 'orders-api',
        },
      ),
    ).rejects.toThrow('Deployment target not found');
  });

  it('detaches a target from alphaCI without calling provider delete APIs', async () => {
    deploymentTargetsRepository.deleteDeploymentTargetForUser.mockResolvedValueOnce(
      true,
    );

    await expect(
      service.detachDeploymentTarget('project-1', 'target-1', 'user-1'),
    ).resolves.toEqual({ detached: true });

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(
      deploymentTargetsRepository.deleteDeploymentTargetForUser,
    ).toHaveBeenCalledWith('project-1', 'target-1', 'user-1');
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'deployment_target_detached',
      }),
    );
  });

  it('reports provider-write actions disabled until live provider activation', async () => {
    deploymentTargetsRepository.findDeploymentTargetForUser.mockResolvedValueOnce(
      {
        id: 'target-1',
        projectId: 'project-1',
        provider: 'vercel',
        providerProjectId: 'prj_1',
        providerProjectName: 'orders-web',
        providerMetadata: { vercelTeamSlug: 'flowci-team' },
      },
    );

    await expect(
      service.getDeploymentTargetActions('project-1', 'target-1', 'user-1'),
    ).resolves.toMatchObject({
      targetId: 'target-1',
      actions: {
        sync: { enabled: true, mode: 'local_metadata' },
        detach: { enabled: true },
        reinstallDeploymentSecrets: {
          enabled: false,
          reason: 'Provider activation required',
        },
        openProviderDashboard: {
          enabled: true,
          url: 'https://vercel.com/flowci-team/orders-web',
        },
      },
    });
  });

  it('syncs target state from stored metadata only', async () => {
    deploymentTargetsRepository.findDeploymentTargetForUser.mockResolvedValueOnce(
      {
        id: 'target-1',
        projectId: 'project-1',
        provider: 'render',
        providerProjectId: 'srv-1',
        providerProjectName: 'orders-api-test',
        branchName: 'test',
        rootDirectory: null,
        status: 'active',
        providerMetadata: {},
      },
    );

    await expect(
      service.syncDeploymentTarget('project-1', 'target-1', 'user-1'),
    ).resolves.toMatchObject({
      mode: 'local_metadata',
      status: 'active',
      findings: [],
      target: {
        id: 'target-1',
      },
    });

    expect(vercelClient.createTarget).not.toHaveBeenCalled();
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'deployment_target_synced',
      }),
    );
  });
});
