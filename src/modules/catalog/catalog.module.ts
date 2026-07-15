import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { GithubModule } from '../github/github.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [SubscriptionModule, PersistenceModule, GithubModule],
  controllers: [CatalogController],
  providers: [CatalogService, SessionAuthGuard, SubscriptionGuard],
  exports: [CatalogService],
})
export class CatalogModule {}
