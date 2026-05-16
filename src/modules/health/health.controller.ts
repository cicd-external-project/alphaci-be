import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';

@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getHealth() {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      templateSource: `${appConfig.templates.repoPath}/${appConfig.templates.workflowDir}`,
    };
  }
}
