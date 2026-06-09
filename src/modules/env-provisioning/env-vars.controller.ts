import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import type { ProvisionEnvVarsDto } from './dto/provision-env-vars.dto';
import { EnvFeatureGuard } from './env-feature.guard';
import { EnvVarsService } from './env-vars.service';

@Controller('projects/:projectId/env-vars')
@UseGuards(SessionAuthGuard, SubscriptionGuard, EnvFeatureGuard)
export class EnvVarsController {
  constructor(private readonly service: EnvVarsService) {}

  @Get()
  list(@Param('projectId') projectId: string) {
    return this.service.listEnvMetadata(projectId);
  }

  @Post('provision')
  provision(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: ProvisionEnvVarsDto,
  ) {
    return this.service.provisionEnvVars(projectId, req.session.user!.id, body);
  }
}
