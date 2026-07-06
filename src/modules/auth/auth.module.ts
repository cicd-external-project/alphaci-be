import { Module } from '@nestjs/common';

import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ProjectsModule } from '../projects/projects.module';
import { AdminModule } from '../admin/admin.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';

@Module({
  imports: [SubscriptionModule, PersistenceModule, ProjectsModule, AdminModule],
  controllers: [AuthController],
  providers: [AuthService, IdentityService, DevOnlyGuard, SessionAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
