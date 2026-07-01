import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DomainsController } from './domains.controller';
import { DomainsRepository } from './domains.repository';
import { DomainsService } from './domains.service';
import { FakeDomainVerifier } from './fake-domain-verifier';

@Module({
  imports: [DatabaseModule],
  controllers: [DomainsController],
  providers: [DomainsRepository, DomainsService, FakeDomainVerifier],
  exports: [DomainsService, DomainsRepository],
})
export class DomainsModule {}
