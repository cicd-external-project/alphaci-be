import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [CatalogModule, SubscriptionModule, PersistenceModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, SessionAuthGuard, SubscriptionGuard],
})
export class WorkflowsModule {}
