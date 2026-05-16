import { Module } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [SubscriptionModule, PersistenceModule],
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
