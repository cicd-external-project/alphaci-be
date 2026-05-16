import { Module } from "@nestjs/common";

import { SessionAuthGuard } from "../../common/guards/session-auth.guard";
import { PersistenceModule } from "../persistence/persistence.module";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";

@Module({
  imports: [PersistenceModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SessionAuthGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
