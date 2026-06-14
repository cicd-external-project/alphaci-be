import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { DatabaseModule } from '../database/database.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [DatabaseModule, PersistenceModule],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService, SessionAuthGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
