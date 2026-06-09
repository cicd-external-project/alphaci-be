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

    return {
      envProvisioning: {
        enabled,
        providers: enabled ? ['render', 'vercel'] : [],
        environments: enabled ? ['test', 'uat', 'production'] : [],
        modes: enabled ? ['byo', 'flowci_managed'] : [],
      },
    };
  }
}
