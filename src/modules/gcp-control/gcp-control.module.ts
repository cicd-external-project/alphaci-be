import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { GcpProviderCapabilitiesService } from './gcp-provider-capabilities.service';
import { ProvisioningJobsRepository } from './provisioning-jobs.repository';

@Module({
  imports: [DatabaseModule],
  providers: [GcpProviderCapabilitiesService, ProvisioningJobsRepository],
  exports: [GcpProviderCapabilitiesService, ProvisioningJobsRepository],
})
export class GcpControlModule {}
