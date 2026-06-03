import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type {
  SessionUser,
  SubscriptionPlan,
  SubscriptionState,
} from '../../common/interfaces/session-user.interface';
import { OutboxRepository } from '../persistence/outbox.repository';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository';

export interface PaymentCheckoutSession {
  checkoutId?: string;
  id?: string;
  status: string;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SubscriptionService {
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
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

  // Payment gateway removed — api-center no longer used.
  // These endpoints are preserved for API compatibility but will always return 503
  // until a direct payment provider integration is wired in.
  async createCheckoutSession(
    _user: SessionUser,
    _plan: 'pro',
  ): Promise<PaymentCheckoutSession> {
    throw new ServiceUnavailableException('Payment service is unavailable');
  }

  async getCheckoutStatus(
    _user: SessionUser,
    _checkoutId: string,
  ): Promise<{ status: string; subscription?: SubscriptionState }> {
    throw new ServiceUnavailableException('Payment service is unavailable');
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
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenException('Not available in production');
    }
    if (!this.config.subscription.mockEnabled) {
      throw new ForbiddenException('Subscription mock endpoints are disabled');
    }
  }
}
