import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { GcpProviderCapabilitiesService } from '../gcp-control/gcp-provider-capabilities.service';
import { CapabilitiesController } from './capabilities.controller';

const makeConfig = (enabled: boolean) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        enabled,
      },
      projectSyncSnapshots: {
        enabled,
        liveGithubEnabled: false,
        liveProvidersEnabled: false,
      },
      workflowSettingsPreview: {
        enabled,
      },
      workflowUpdatePr: {
        enabled,
      },
      projectTargetManagement: {
        enabled,
      },
      ciRunTracking: {
        enabled,
        liveGithubEnabled: false,
      },
      deploymentHistory: {
        enabled,
        liveProvidersEnabled: false,
      },
      driftDetection: {
        enabled,
        liveProviderChecksEnabled: false,
      },
      driftLiveChecks: {
        enabled: false,
      },
      driftRepair: {
        enabled,
        liveRepairEnabled: false,
      },
      usageQuotas: {
        enabled,
      },
      workspaces: {
        enabled,
      },
      auditEvents: {
        enabled,
      },
      notifications: {
        enabled,
      },
    }),
  }) as unknown as ConfigService;

describe('CapabilitiesController', () => {
  const providerCapabilities = {
    getCapabilities: jest.fn().mockReturnValue({
      gcp: {
        provider: 'gcp',
        enabled: false,
        disabledReason: 'gcp_deployments_disabled',
        deploymentStrategy: 'gcp_cloud_run',
        runtimeScopes: [],
        supportsPreviewDeployments: false,
        supportsCustomDomains: false,
        requiresProviderConnection: false,
        customerDatabaseManagedByAlphaCI: false,
        defaults: {
          projectId: null,
          region: 'asia-southeast1',
          artifactRegistryRepository: null,
        },
      },
      legacyProviders: {
        vercel: {
          provider: 'vercel',
          enabledForNewTargets: false,
          requiresProviderConnection: false,
        },
        render: {
          provider: 'render',
          enabledForNewTargets: false,
          requiresProviderConnection: false,
        },
        byoDeploymentProviders: {
          enabledForNewConnections: false,
        },
      },
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports env provisioning enabled capabilities', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [
        { provide: ConfigService, useValue: makeConfig(true) },
        {
          provide: GcpProviderCapabilitiesService,
          useValue: providerCapabilities,
        },
      ],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: true,
        providers: ['render', 'vercel'],
        environments: ['test', 'uat', 'production'],
        modes: ['byo', 'flowci_managed'],
      },
      projectSyncSnapshots: {
        enabled: true,
        liveGithubEnabled: false,
        liveProvidersEnabled: false,
        mode: 'local_snapshot',
      },
      workflowSettingsPreview: {
        enabled: true,
      },
      workflowUpdatePr: {
        enabled: true,
      },
      projectTargetManagement: {
        enabled: true,
      },
      ciRunTracking: {
        enabled: true,
        liveGithubEnabled: false,
        mode: 'local_mock',
      },
      deploymentHistory: {
        enabled: true,
        liveProvidersEnabled: false,
        mode: 'local_mock',
      },
      driftDetection: {
        enabled: true,
        liveProviderChecksEnabled: false,
        mode: 'local_snapshot',
      },
      driftRepair: {
        enabled: true,
        liveRepairEnabled: false,
        mode: 'local_safe',
      },
      usageQuotas: {
        enabled: true,
      },
      workspaces: {
        enabled: true,
      },
      auditEvents: {
        enabled: true,
      },
      notifications: {
        enabled: true,
      },
      deploymentProviders: providerCapabilities.getCapabilities(),
    });
  });

  it('reports env provisioning disabled without provider lists', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [
        { provide: ConfigService, useValue: makeConfig(false) },
        {
          provide: GcpProviderCapabilitiesService,
          useValue: providerCapabilities,
        },
      ],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: false,
        providers: [],
        environments: [],
        modes: [],
      },
      projectSyncSnapshots: {
        enabled: false,
        liveGithubEnabled: false,
        liveProvidersEnabled: false,
        mode: 'local_snapshot',
      },
      workflowSettingsPreview: {
        enabled: false,
      },
      workflowUpdatePr: {
        enabled: false,
      },
      projectTargetManagement: {
        enabled: false,
      },
      ciRunTracking: {
        enabled: false,
        liveGithubEnabled: false,
        mode: 'local_mock',
      },
      deploymentHistory: {
        enabled: false,
        liveProvidersEnabled: false,
        mode: 'local_mock',
      },
      driftDetection: {
        enabled: false,
        liveProviderChecksEnabled: false,
        mode: 'local_snapshot',
      },
      driftRepair: {
        enabled: false,
        liveRepairEnabled: false,
        mode: 'local_safe',
      },
      usageQuotas: {
        enabled: false,
      },
      workspaces: {
        enabled: false,
      },
      auditEvents: {
        enabled: false,
      },
      notifications: {
        enabled: false,
      },
      deploymentProviders: providerCapabilities.getCapabilities(),
    });
  });

  it('does not report live adapter modes without live adapter implementations', async () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: { enabled: true },
        projectSyncSnapshots: {
          enabled: true,
          liveGithubEnabled: true,
          liveProvidersEnabled: true,
        },
        workflowSettingsPreview: { enabled: true },
        workflowUpdatePr: { enabled: true },
        projectTargetManagement: { enabled: true },
        ciRunTracking: { enabled: true, liveGithubEnabled: true },
        deploymentHistory: { enabled: true, liveProvidersEnabled: true },
        driftDetection: { enabled: true },
        driftLiveChecks: { enabled: true },
        driftRepair: { enabled: true, liveRepairEnabled: true },
        usageQuotas: { enabled: true },
        workspaces: { enabled: true },
        auditEvents: { enabled: true },
        notifications: { enabled: true },
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [
        { provide: ConfigService, useValue: configService },
        {
          provide: GcpProviderCapabilitiesService,
          useValue: providerCapabilities,
        },
      ],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toMatchObject({
      projectSyncSnapshots: {
        liveGithubEnabled: false,
        liveProvidersEnabled: false,
        mode: 'local_snapshot',
      },
      ciRunTracking: {
        liveGithubEnabled: false,
        mode: 'local_mock',
      },
      deploymentHistory: {
        liveProvidersEnabled: false,
        mode: 'local_mock',
      },
      driftDetection: {
        liveProviderChecksEnabled: false,
        mode: 'local_snapshot',
      },
      driftRepair: {
        liveRepairEnabled: false,
        mode: 'local_safe',
      },
    });
  });
});
