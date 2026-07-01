import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type {
  DeploymentProviderCapabilities,
  GcpProviderCapabilities,
} from './gcp-control.types';

@Injectable()
export class GcpProviderCapabilitiesService {
  constructor(private readonly configService: ConfigService) {}

  getCapabilities(): DeploymentProviderCapabilities {
    const config = this.configService.getOrThrow<AppConfig>('app');

    return {
      gcp: this.getGcpCapabilities(config),
      legacyProviders: {
        vercel: {
          provider: 'vercel',
          enabledForNewTargets: config.legacyProviders.vercelEnabled,
          requiresProviderConnection: false,
        },
        render: {
          provider: 'render',
          enabledForNewTargets: config.legacyProviders.renderEnabled,
          requiresProviderConnection: false,
        },
        byoDeploymentProviders: {
          enabledForNewConnections:
            config.legacyProviders.byoDeploymentProviderEnabled,
        },
      },
    };
  }

  private getGcpCapabilities(config: AppConfig): GcpProviderCapabilities {
    const gcp = config.gcpDeployments;
    const hasRequiredRuntimeConfig = Boolean(
      gcp.sharedProjectId &&
      gcp.region &&
      gcp.workloadIdentityProvider &&
      gcp.deployerServiceAccount &&
      gcp.artifactRegistryRepository,
    );
    const enabled = gcp.enabled && hasRequiredRuntimeConfig;

    return {
      provider: 'gcp',
      enabled,
      disabledReason: this.resolveDisabledReason(
        gcp.enabled,
        hasRequiredRuntimeConfig,
      ),
      deploymentStrategy: 'gcp_cloud_run',
      runtimeScopes: enabled
        ? [
            'shared_project',
            ...(gcp.dedicatedProjectsEnabled
              ? (['dedicated_customer_project'] as const)
              : []),
          ]
        : [],
      supportsPreviewDeployments: enabled && gcp.previewDeploymentsEnabled,
      supportsCustomDomains: enabled && gcp.customDomainsEnabled,
      requiresProviderConnection: false,
      customerDatabaseManagedByAlphaCI: false,
      defaults: {
        projectId: gcp.sharedProjectId,
        region: gcp.region,
        artifactRegistryRepository: gcp.artifactRegistryRepository,
      },
    };
  }

  private resolveDisabledReason(
    flagEnabled: boolean,
    hasRequiredRuntimeConfig: boolean,
  ): GcpProviderCapabilities['disabledReason'] {
    if (!flagEnabled) {
      return 'gcp_deployments_disabled';
    }

    if (!hasRequiredRuntimeConfig) {
      return 'missing_gcp_runtime_config';
    }

    return null;
  }
}
