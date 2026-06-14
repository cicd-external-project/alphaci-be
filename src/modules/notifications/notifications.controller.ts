import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '../../config/app.config';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  list(@Req() req: Request) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const config = this.configService.getOrThrow<AppConfig>('app');
    if (!config.notifications.enabled) {
      return { enabled: false, items: [], unreadCount: 0 };
    }
    return this.notificationsService.listForUser(userId);
  }

  @Post(':id/read')
  @UseGuards(SessionAuthGuard)
  markRead(@Req() req: Request, @Param('id') id: string) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const config = this.configService.getOrThrow<AppConfig>('app');
    if (!config.notifications.enabled) {
      throw new BadRequestException('Notifications are disabled');
    }
    return this.notificationsService.markRead(userId, id);
  }
}
