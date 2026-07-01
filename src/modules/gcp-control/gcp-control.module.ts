import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FakeGcpRuntimeAdapter } from './fake-gcp-runtime.adapter';
import { GcpProviderCapabilitiesService } from './gcp-provider-capabilities.service';
import { GcpProvisioningOrchestratorService } from './gcp-provisioning-orchestrator.service';
import { GcpRuntimeReconcilerService } from './gcp-runtime-reconciler.service';
import { GCP_RUNTIME_ADAPTER } from './gcp-runtime.adapter';
import { ProvisioningJobsRepository } from './provisioning-jobs.repository';
import { RuntimeEntitlementsService } from './runtime-entitlements.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    GcpProviderCapabilitiesService,
    ProvisioningJobsRepository,
    GcpProvisioningOrchestratorService,
    GcpRuntimeReconcilerService,
    RuntimeEntitlementsService,
    RuntimeEntitlementsService,
    {
      provide: GCP_RUNTIME_ADAPTER,
      useClass: FakeGcpRuntimeAdapter,
    },
  ],
  exports: [
    GcpProviderCapabilitiesService,
    ProvisioningJobsRepository,
    GcpProvisioningOrchestratorService,
    GcpRuntimeReconcilerService,
    RuntimeEntitlementsService,
    RuntimeEntitlementsService,
    GCP_RUNTIME_ADAPTER,
  ],
})
export class GcpControlModule {}
