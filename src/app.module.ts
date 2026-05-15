import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiCenterSdkModule } from './api-center/api-center-sdk.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv } from './common/config/env.validation.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { HealthModule } from './health/health.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { LocationModule } from './location/location.module.js';

const shouldValidateEnv = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
      // Fail fast on production misconfiguration while keeping local DX flexible.
      ...(shouldValidateEnv ? { validate: validateEnv } : {}),
    }),
    SupabaseModule,
    HealthModule,
    ApiCenterSdkModule,
    LocationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
