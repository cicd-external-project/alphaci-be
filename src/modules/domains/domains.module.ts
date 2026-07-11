import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { DomainsController } from './domains.controller';
import { DomainsRepository } from './domains.repository';
import { DomainsService } from './domains.service';
import { FakeDomainVerifier } from './fake-domain-verifier';

@Module({
  imports: [DatabaseModule, PersistenceModule, SubscriptionModule],
  controllers: [DomainsController],
  providers: [DomainsRepository, DomainsService, FakeDomainVerifier],
  exports: [DomainsService, DomainsRepository],
})
export class DomainsModule {}
