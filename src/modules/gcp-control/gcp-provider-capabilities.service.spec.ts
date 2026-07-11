import { GcpProviderCapabilitiesService } from './gcp-provider-capabilities.service';

describe('GcpProviderCapabilitiesService', () => {
  it('hides GCP when the deployment flag is disabled', () => {
    const service = new GcpProviderCapabilitiesService(
      makeConfigService({
        gcpDeployments: {
          enabled: false,
          sharedProjectId: 'alphaci-runtime',
          region: 'asia-southeast1',
          workloadIdentityProvider: 'wif-provider',
          deployerServiceAccount:
            'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
          artifactRegistryRepository: 'alphaci-services',
          dedicatedProjectsEnabled: true,
          customDomainsEnabled: true,
          previewDeploymentsEnabled: true,
        },
      }) as never,
    );

    expect(service.getCapabilities().gcp).toEqual(
      expect.objectContaining({
        provider: 'gcp',
        enabled: false,
        disabledReason: 'gcp_deployments_disabled',
        runtimeScopes: [],
      }),
    );
  });

  it('shows shared-project GCP when enabled and required runtime config exists', () => {
    const service = new GcpProviderCapabilitiesService(
      makeConfigService({
        gcpDeployments: {
          enabled: true,
          sharedProjectId: 'alphaci-runtime',
          region: 'asia-southeast1',
          workloadIdentityProvider: 'wif-provider',
          deployerServiceAccount:
            'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
          artifactRegistryRepository: 'alphaci-services',
          dedicatedProjectsEnabled: false,
          customDomainsEnabled: false,
          previewDeploymentsEnabled: false,
        },
      }) as never,
    );

    expect(service.getCapabilities().gcp).toEqual({
      provider: 'gcp',
      enabled: true,
      disabledReason: null,
      deploymentStrategy: 'gcp_cloud_run',
      runtimeScopes: ['shared_project'],
      supportsPreviewDeployments: false,
      supportsCustomDomains: false,
      requiresProviderConnection: false,
      customerDatabaseManagedByAlphaCI: false,
      defaults: {
        projectId: 'alphaci-runtime',
        region: 'asia-southeast1',
        artifactRegistryRepository: 'alphaci-services',
      },
    });
  });

  it('keeps GCP hidden when required runtime config is missing', () => {
    const service = new GcpProviderCapabilitiesService(
      makeConfigService({
        gcpDeployments: {
          enabled: true,
          sharedProjectId: null,
          region: 'asia-southeast1',
          workloadIdentityProvider: null,
          deployerServiceAccount: null,
          artifactRegistryRepository: null,
          dedicatedProjectsEnabled: false,
          customDomainsEnabled: false,
          previewDeploymentsEnabled: false,
        },
      }) as never,
    );

    expect(service.getCapabilities().gcp).toEqual(
      expect.objectContaining({
        enabled: false,
        disabledReason: 'missing_gcp_runtime_config',
        runtimeScopes: [],
      }),
    );
  });

  it('exposes dedicated projects, previews, and custom domains only behind their flags', () => {
    const service = new GcpProviderCapabilitiesService(
      makeConfigService({
        gcpDeployments: {
          enabled: true,
          sharedProjectId: 'alphaci-runtime',
          region: 'asia-southeast1',
          workloadIdentityProvider: 'wif-provider',
          deployerServiceAccount:
            'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
          artifactRegistryRepository: 'alphaci-services',
          dedicatedProjectsEnabled: true,
          customDomainsEnabled: true,
          previewDeploymentsEnabled: true,
        },
      }) as never,
    );

    expect(service.getCapabilities().gcp).toMatchObject({
      runtimeScopes: ['shared_project', 'dedicated_customer_project'],
      supportsPreviewDeployments: true,
      supportsCustomDomains: true,
    });
  });

  it('hides legacy Vercel and Render providers when their rollout flags are disabled', () => {
    const service = new GcpProviderCapabilitiesService(
      makeConfigService({
        legacyProviders: {
          vercelEnabled: false,
          renderEnabled: false,
          byoDeploymentProviderEnabled: false,
        },
      }) as never,
    );

    expect(service.getCapabilities().legacyProviders).toEqual({
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
    });
  });
});

function makeConfigService(overrides: Record<string, unknown>) {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      gcpDeployments: {
        enabled: false,
        sharedProjectId: null,
        region: 'asia-southeast1',
        workloadIdentityProvider: null,
        deployerServiceAccount: null,
        artifactRegistryRepository: null,
        dedicatedProjectsEnabled: false,
        customDomainsEnabled: false,
        previewDeploymentsEnabled: false,
      },
      legacyProviders: {
        vercelEnabled: false,
        renderEnabled: false,
        byoDeploymentProviderEnabled: false,
      },
      ...overrides,
    }),
  };
}
