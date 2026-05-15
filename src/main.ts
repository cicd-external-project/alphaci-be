import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import {
  BODY_SIZE_LIMIT,
  corsOptions,
  helmetConfig,
  helmetConfigSwagger,
} from './common/config/security.config.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);

  const enableSwagger = configService.get<string>('ENABLE_SWAGGER') === 'true';

  // Helmet — CISO-managed config (security.config.ts)
  app.use(helmet(enableSwagger ? helmetConfigSwagger : helmetConfig));

  // Body parsers with size limit (bodyParser disabled at factory level)
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

  // Graceful shutdown
  app.enableShutdownHooks();

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  // CORS — CISO-managed factory (security.config.ts)
  const allowedOriginsEnv = configService.get<string>('ALLOWED_ORIGINS');
  app.enableCors(corsOptions(allowedOriginsEnv));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger (conditional)
  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tribe Backend')
      .setDescription('Tribe Backend API')
      .setVersion('1.0.0')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
    logger.log('Swagger docs available at /api/v1/docs');
  }

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application running on 0.0.0.0:${String(port)}`);
}

void bootstrap();
