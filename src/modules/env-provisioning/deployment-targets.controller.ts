import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import type { CreateDeploymentTargetDto } from './dto/create-deployment-target.dto';
import type { DetachDeploymentTargetDto } from './dto/detach-deployment-target.dto';
import { DeploymentTargetsService } from './deployment-targets.service';
import type { UpdateDeploymentTargetMetadataInput } from './deployment-targets.repository';
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

  @Get(':targetId/actions')
  actions(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.getDeploymentTargetActions(
      projectId,
      targetId,
      req.session.user!.id,
    );
  }

  @Post(':targetId/sync')
  sync(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.syncDeploymentTarget(
      projectId,
      targetId,
      req.session.user!.id,
    );
  }

  @Patch(':targetId')
  update(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('targetId') targetId: string,
    @Body() body: UpdateDeploymentTargetMetadataInput,
  ) {
    return this.service.updateDeploymentTargetMetadata(
      projectId,
      targetId,
      req.session.user!.id,
      body,
    );
  }

  @Get(':targetId/logs')
  logs(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.getDeploymentTargetLogs(
      projectId,
      targetId,
      req.session.user!.id,
    );
  }

  @Delete(':targetId')
  detach(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('targetId') targetId: string,
    @Body() body?: DetachDeploymentTargetDto,
  ) {
    return this.service.detachDeploymentTarget(
      projectId,
      targetId,
      req.session.user!.id,
      body,
    );
  }
}
