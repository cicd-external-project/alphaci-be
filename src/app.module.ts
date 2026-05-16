import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './config/app.config.js';
import { ApiCenterSdkModule } from './api-center/api-center-sdk.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv } from './common/config/env.validation.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { HealthModule } from './health/health.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { LocationModule } from './location/location.module.js';
import { ExternalModule } from './external/external.module.js';

// Ported Modules
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { SubscriptionModule } from './modules/subscription/subscription.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';

const shouldValidateEnv = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
      load: [appConfig],
      ...(shouldValidateEnv ? { validate: validateEnv } : {}),
    }),
    SupabaseModule,
    HealthModule,
    ApiCenterSdkModule,
    LocationModule,
    ExternalModule,

    // Business modules
    AuthModule,
    CatalogModule,
    SubscriptionModule,
    WorkflowsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
