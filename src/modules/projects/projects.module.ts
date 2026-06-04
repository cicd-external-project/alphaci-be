import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from '../database/database.module';
import { GithubModule } from '../github/github.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    DatabaseModule,
    PersistenceModule,    // UsersRepository (needed by SessionAuthGuard)
    CatalogModule,        // CatalogService
    GithubModule,         // GithubService
    SubscriptionModule,   // SubscriptionService (needed by SubscriptionGuard)
  ],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectsRepository,
    SessionAuthGuard,
    SubscriptionGuard,
  ],
})
export class ProjectsModule {}
