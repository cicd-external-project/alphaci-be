import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { GcpDeploymentTargetsRepository } from './deployment-targets-gcp.repository';

@Module({
  imports: [DatabaseModule],
  providers: [GcpDeploymentTargetsRepository],
  exports: [GcpDeploymentTargetsRepository],
})
export class GcpRuntimeModule {}
