import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { DatabaseModule } from '../database/database.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { ProjectsRepository } from '../projects/projects.repository';
import { SubscriptionModule } from '../subscription/subscription.module';
import { DeploymentTargetsController } from './deployment-targets.controller';
import { DeploymentTargetsRepository } from './deployment-targets.repository';
import { DeploymentTargetsService } from './deployment-targets.service';
import { EnvTokenEncryptionService } from './encryption.service';
import { EnvFeatureGuard } from './env-feature.guard';
import { EnvVarsController } from './env-vars.controller';
import { EnvVarsRepository } from './env-vars.repository';
import { EnvVarsService } from './env-vars.service';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { RenderEnvClient } from './provider-clients/render-env.client';
import { VercelEnvClient } from './provider-clients/vercel-env.client';
import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderConnectionsRepository } from './provider-connections.repository';
import { ProviderConnectionsService } from './provider-connections.service';

@Module({
  imports: [DatabaseModule, PersistenceModule, SubscriptionModule],
  controllers: [
    ProviderConnectionsController,
    DeploymentTargetsController,
    EnvVarsController,
  ],
  providers: [
    ProjectsRepository,
    ProviderConnectionsRepository,
    DeploymentTargetsRepository,
    EnvVarsRepository,
    ProviderConnectionsService,
    DeploymentTargetsService,
    EnvVarsService,
    EnvTokenEncryptionService,
    RenderEnvClient,
    VercelEnvClient,
    ProviderClientRegistry,
    EnvFeatureGuard,
    SessionAuthGuard,
    SubscriptionGuard,
  ],
})
export class EnvProvisioningModule {}
