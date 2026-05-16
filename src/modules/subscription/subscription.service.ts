import { ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../config/app.config";
import type {
  SessionUser,
  SubscriptionPlan,
  SubscriptionState,
} from "../../common/interfaces/session-user.interface";
import { OutboxRepository } from "../persistence/outbox.repository";
import { SubscriptionsRepository } from "../persistence/subscriptions.repository";

@Injectable()
export class SubscriptionService {
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>("app");
  }

  async getForUser(user: SessionUser): Promise<SubscriptionState> {
    const existing = await this.subscriptionsRepository.getCurrentByUserId(user.id);
    if (existing) {
      return existing;
    }

    const seededPlan = this.config.subscription.seededPlans[user.login] ?? this.config.subscription.seededPlans[user.id];
    const plan = seededPlan ?? this.config.subscription.defaultPlan;

    if (plan === "pro") {
      return this.subscriptionsRepository.activateMonthlyPlan(
        user.id,
        "pro_monthly",
        this.config.subscription.proMonthlyPricePhp,
        "manual",
      );
    }

    if (plan === "enterprise") {
      return this.subscriptionsRepository.activateMonthlyPlan(
        user.id,
        "enterprise_monthly",
        this.config.subscription.enterpriseMonthlyPricePhp,
        "manual",
      );
    }

    return this.subscriptionsRepository.ensureDefaultFreeSubscription(user.id);
  }

  async activateForUser(user: SessionUser, plan: SubscriptionPlan = "pro"): Promise<SubscriptionState> {
    this.assertMockEnabled();

    const nextState =
      plan === "enterprise"
        ? await this.subscriptionsRepository.activateMonthlyPlan(
            user.id,
            "enterprise_monthly",
            this.config.subscription.enterpriseMonthlyPricePhp,
            "manual",
          )
        : await this.subscriptionsRepository.activateMonthlyPlan(
            user.id,
            "pro_monthly",
            this.config.subscription.proMonthlyPricePhp,
            "manual",
          );

    await this.outboxRepository.publishLater({
      topic: "subscription.activated",
      aggregateType: "subscription",
      aggregateId: user.id,
      payload: {
        userId: user.id,
        plan: nextState.plan,
        planCode: nextState.planCode,
      },
    });

    return nextState;
  }

  async cancelForUser(user: SessionUser): Promise<SubscriptionState> {
    this.assertMockEnabled();

    const nextState = await this.subscriptionsRepository.cancelCurrent(user.id);

    await this.outboxRepository.publishLater({
      topic: "subscription.canceled",
      aggregateType: "subscription",
      aggregateId: user.id,
      payload: {
        userId: user.id,
        plan: nextState.plan,
        planCode: nextState.planCode,
      },
    });

    return nextState;
  }

  private assertMockEnabled(): void {
    if (!this.config.subscription.mockEnabled) {
      throw new ForbiddenException("Subscription mock endpoints are disabled");
    }
  }
}
