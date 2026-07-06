import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { EmailVerificationCodesRepository } from './email-verification-codes.repository';
import { OAuthStateRepository } from './oauth-state.repository';
import { OutboxRepository } from './outbox.repository';
import { SubscriptionsRepository } from './subscriptions.repository';
import { UserIdentitiesRepository } from './user-identities.repository';
import { UsersRepository } from './users.repository';
import { WorkflowHistoryRepository } from './workflow-history.repository';
import { CiTokensRepository } from '../ci/ci-tokens.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
    CiTokensRepository,
    UserIdentitiesRepository,
    EmailVerificationCodesRepository,
  ],
  exports: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
    CiTokensRepository,
    UserIdentitiesRepository,
    EmailVerificationCodesRepository,
  ],
})
export class PersistenceModule {}
