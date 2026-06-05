import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OAuthStateRepository } from './oauth-state.repository';
import { OutboxRepository } from './outbox.repository';
import { SubscriptionsRepository } from './subscriptions.repository';
import { UsersRepository } from './users.repository';
import { WorkflowHistoryRepository } from './workflow-history.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
  ],
  exports: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
  ],
})
export class PersistenceModule {}
