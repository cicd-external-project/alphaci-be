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
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import { DeploymentTargetsService } from './deployment-targets.service';
import { EnvFeatureGuard } from './env-feature.guard';

@Controller('projects/:projectId/deployment-targets')
@UseGuards(SessionAuthGuard, SubscriptionGuard, EnvFeatureGuard)
export class DeploymentTargetsController {
  constructor(private readonly service: DeploymentTargetsService) {}

  @Get()
  list(@Req() req: Request, @Param('projectId') projectId: string) {
    return this.service.listDeploymentTargets(projectId, req.session.user!.id);
  }

  @Post()
  create(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: CreateDeploymentTargetDto,
  ) {
    return this.service.createDeploymentTarget(
      projectId,
      req.session.user!.id,
      body,
    );
  }
}
