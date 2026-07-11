import { Module } from '@nestjs/common';

import { GcpControlModule } from '../gcp-control/gcp-control.module';
import { CapabilitiesController } from './capabilities.controller';

@Module({
  imports: [GcpControlModule],
  controllers: [CapabilitiesController],
})
export class CapabilitiesModule {}
