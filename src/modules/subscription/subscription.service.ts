import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TribeClient } from '@implementsprint/sdk';
import type { PaymentCheckoutSession } from '@implementsprint/sdk';

import type { AppConfig } from '../../config/app.config';
import type {
  SessionUser,
  SubscriptionPlan,
  SubscriptionState,
} from '../../common/interfaces/session-user.interface';
import { OutboxRepository } from '../persistence/outbox.repository';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository';

@Injectable()
export class SubscriptionService {
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
    @Optional() @Inject(TribeClient) private readonly apiCenter: TribeClient | null,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
  }

  async getForUser(user: SessionUser): Promise<SubscriptionState> {
    const existing = await this.subscriptionsRepository.getCurrentByUserId(
      user.id,
    );
    if (existing) {
      return existing;
    }

    const seededPlan =
      this.config.subscription.seededPlans[user.login] ??
      this.config.subscription.seededPlans[user.id];
    const plan = seededPlan ?? this.config.subscription.defaultPlan;

    if (plan === 'pro') {
      return this.subscriptionsRepository.activateMonthlyPlan(
        user.id,
        'pro_monthly',
        this.config.subscription.proMonthlyPricePhp,
        'manual',
      );
    }

    return this.subscriptionsRepository.ensureDefaultFreeSubscription(user.id);
  }

  async createCheckoutSession(
    user: SessionUser,
    plan: 'pro',
  ): Promise<PaymentCheckoutSession> {
    if (!this.apiCenter) {
      throw new ServiceUnavailableException('Payment service is unavailable');
    }

    const pricePhp = this.config.subscription.proMonthlyPricePhp;
    const planLabel = 'Pro Monthly';
    const referenceId = `${user.id}-${plan}-${Date.now()}`;

    return this.apiCenter.paymentCreateCheckoutSession({
      referenceId,
      idempotencyKey: referenceId,
      successUrl: `${this.config.frontendUrl}/subscription/success`,
      cancelUrl: `${this.config.frontendUrl}/subscription`,
      lineItems: [
        {
          name: planLabel,
          quantity: 1,
          // PayMongo accepts value in centavos (smallest PHP unit)
          amount: { value: pricePhp * 100, currency: 'PHP' },
        },
      ],
      metadata: {
        userId: user.id,
        plan,
      },
    });
  }

  async getCheckoutStatus(
    user: SessionUser,
    checkoutId: string,
  ): Promise<{ status: string; subscription?: SubscriptionState }> {
    if (!this.apiCenter) {
      throw new ServiceUnavailableException('Payment service is unavailable');
    }

    const session = await this.apiCenter.paymentGetCheckoutSession(checkoutId);

    if (session.metadata?.['userId'] !== user.id) {
      throw new ForbiddenException('Checkout not found');
    }

    if (session.status === 'paid') {
      const rawPlan = session.metadata?.['plan'];
      if (rawPlan !== 'pro') {
        throw new Error(`Unexpected plan value in checkout metadata: ${String(rawPlan)}`);
      }
      const pricePhp = this.config.subscription.proMonthlyPricePhp;

      const subscription = await this.subscriptionsRepository.activateMonthlyPlan(
        user.id,
        'pro_monthly',
        pricePhp,
        'paymongo',
      );

      await this.outboxRepository.publishLater({
        topic: 'subscription.activated',
        aggregateType: 'subscription',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          plan: subscription.plan,
          planCode: subscription.planCode,
        },
      });

      return { status: 'paid', subscription };
    }

    return { status: session.status };
  }

  async activateForUser(
    user: SessionUser,
    _plan: SubscriptionPlan = 'pro',
  ): Promise<SubscriptionState> {
    this.assertMockEnabled();

    const nextState = await this.subscriptionsRepository.activateMonthlyPlan(
      user.id,
      'pro_monthly',
      this.config.subscription.proMonthlyPricePhp,
      'manual',
    );

    await this.outboxRepository.publishLater({
      topic: 'subscription.activated',
      aggregateType: 'subscription',
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
      topic: 'subscription.canceled',
      aggregateType: 'subscription',
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
      throw new ForbiddenException('Subscription mock endpoints are disabled');
    }
  }
}
