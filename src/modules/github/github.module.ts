import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { DatabaseModule } from '../database/database.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { GithubInstallationsRepository } from './github-installations.repository';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [DatabaseModule, PersistenceModule],
  controllers: [GithubController],
  providers: [GithubService, GithubInstallationsRepository, SessionAuthGuard],
})
export class GithubModule {}
