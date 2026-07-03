import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';

@Controller('capabilities')
export class CapabilitiesController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getCapabilities() {
    const config = this.configService.getOrThrow<AppConfig>('app');
    const enabled = config.envProvisioning.enabled;
    const liveAdaptersImplemented = false;

    return {
      envProvisioning: {
        enabled,
        providers: enabled ? ['render', 'vercel'] : [],
        environments: enabled ? ['test', 'uat', 'production'] : [],
        // Advertise the single ownership mode this deployment supports. The
        // external/sold product uses 'byo'; the internal deployment centralizes
        // on the organization's Render/Vercel via 'flowci_managed'.
        modes: enabled ? [config.envProvisioning.ownershipMode] : [],
      },
      projectSyncSnapshots: {
        enabled: config.projectSyncSnapshots.enabled,
        liveGithubEnabled:
          liveAdaptersImplemented &&
          config.projectSyncSnapshots.liveGithubEnabled,
        liveProvidersEnabled:
          liveAdaptersImplemented &&
          config.projectSyncSnapshots.liveProvidersEnabled,
        mode: 'local_snapshot' as const,
      },
      workflowSettingsPreview: {
        enabled: config.workflowSettingsPreview.enabled,
      },
      workflowUpdatePr: {
        enabled: config.workflowUpdatePr.enabled,
      },
      projectTargetManagement: {
        enabled: config.projectTargetManagement.enabled,
      },
      ciRunTracking: {
        enabled: config.ciRunTracking.enabled,
        liveGithubEnabled:
          liveAdaptersImplemented && config.ciRunTracking.liveGithubEnabled,
        mode: 'local_mock' as const,
      },
      deploymentHistory: {
        enabled: config.deploymentHistory.enabled,
        liveProvidersEnabled:
          liveAdaptersImplemented &&
          config.deploymentHistory.liveProvidersEnabled,
        mode: 'local_mock' as const,
      },
      driftDetection: {
        enabled: config.driftDetection.enabled,
        liveProviderChecksEnabled:
          liveAdaptersImplemented && config.driftLiveChecks.enabled,
        mode: 'local_snapshot' as const,
      },
      driftRepair: {
        enabled: config.driftRepair.enabled,
        liveRepairEnabled:
          liveAdaptersImplemented && config.driftRepair.liveRepairEnabled,
        mode: 'local_safe' as const,
      },
      usageQuotas: {
        enabled: config.usageQuotas.enabled,
      },
      workspaces: {
        enabled: config.workspaces.enabled,
      },
      auditEvents: {
        enabled: config.auditEvents.enabled,
      },
      notifications: {
        enabled: config.notifications.enabled,
      },
    };
  }
}
