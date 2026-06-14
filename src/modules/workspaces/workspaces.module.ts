import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { DatabaseModule } from '../database/database.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesRepository } from './workspaces.repository';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [DatabaseModule, PersistenceModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesRepository, WorkspacesService, SessionAuthGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
