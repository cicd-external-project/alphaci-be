import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { ApiCenterSdkModule } from '../api-center/api-center-sdk.module.js';

@Module({
  imports: [SupabaseModule, ApiCenterSdkModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
