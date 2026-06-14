import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '../../config/app.config';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getMyWorkspaces(@Req() req: Request) {
    const user = req.session.user;
    const userId = user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const config = this.configService.getOrThrow<AppConfig>('app');
    if (!config.workspaces.enabled) {
      return { enabled: false, items: [] };
    }

    return this.workspacesService.getMyWorkspaces(userId);
  }
}
