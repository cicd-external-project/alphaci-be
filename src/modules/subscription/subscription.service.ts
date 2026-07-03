import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadGatewayException,
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

interface PayMongoCheckoutSessionResponse {
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      checkout_url?: string;
      metadata?: Record<string, unknown>;
    };
  };
}

interface PayMongoWebhookPayload {
  data?: {
    type?: string;
    data?: {
      attributes?: {
        metadata?: Record<string, unknown>;
      };
    };
  };
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
    // Internal employees (company GitHub org members) and the global
    // gate-disabled mode are both fully entitled without a subscription row,
    // payment, or a visit to /subscribe.
    if (user.isInternal || this.config.subscription.gateEnabled === false) {
      return {
        plan: 'pro' as SubscriptionPlan,
        status: 'active' as const,
        provider: 'manual' as const,
        updatedAt: new Date().toISOString(),
        planCode: 'pro_monthly',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        amountPhp: 0,
        interval: 'month' as const,
      };
    }

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
    user: SessionUser,
    plan: 'pro',
  ): Promise<PaymentCheckoutSession> {
    this.assertPayMongoConfigured();

    const amountPhp = this.config.subscription.proMonthlyPricePhp;
    const response = await fetch(
      'https://api.paymongo.com/v2/checkout_sessions',
      {
        method: 'POST',
        headers: this.paymongoHeaders(),
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                {
                  currency: 'PHP',
                  amount: amountPhp * 100,
                  name: 'alphaCI Studio Pro Monthly',
                  quantity: 1,
                },
              ],
              payment_method_types: ['card', 'gcash', 'qrph'],
              success_url: this.config.subscription.successUrl,
              cancel_url: this.config.subscription.cancelUrl,
              metadata: {
                userId: user.id,
                login: user.login,
                plan,
              },
            },
          },
        }),
      },
    );

    const payload = await this.readPayMongoResponse(response);
    const data = payload.data;

    if (!data?.id || !data.attributes?.checkout_url) {
      throw new BadGatewayException(
        'PayMongo checkout response did not include a checkout URL',
      );
    }

    const checkoutSession: PaymentCheckoutSession = {
      checkoutId: data.id,
      status: data.attributes.status ?? 'created',
      redirectUrl: data.attributes.checkout_url,
    };
    if (data.attributes.metadata) {
      checkoutSession.metadata = data.attributes.metadata;
    }

    return checkoutSession;
  }

  async getCheckoutStatus(
    user: SessionUser,
    checkoutId: string,
  ): Promise<{ status: string; subscription?: SubscriptionState }> {
    this.assertPayMongoConfigured();

    const response = await fetch(
      `https://api.paymongo.com/v2/checkout_sessions/${encodeURIComponent(checkoutId)}`,
      {
        headers: this.paymongoHeaders(),
      },
    );
    const payload = await this.readPayMongoResponse(response);
    const attributes = payload.data?.attributes;
    const status = attributes?.status ?? 'unknown';

    if (status !== 'paid') {
      return { status };
    }

    const metadataUserId = attributes?.metadata?.['userId'];
    if (typeof metadataUserId !== 'string' || metadataUserId !== user.id) {
      throw new ForbiddenException(
        'Checkout session does not belong to this user',
      );
    }

    const subscription = await this.activatePaidPlan(user.id);
    return { status, subscription };
  }

  async handlePayMongoWebhook(
    rawPayload: unknown,
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): Promise<{ received: true; ignored?: boolean }> {
    this.verifyPayMongoSignature(rawBody, signatureHeader);

    const payload = rawPayload as PayMongoWebhookPayload;
    if (payload.data?.type !== 'checkout_session.payment.paid') {
      return { received: true, ignored: true };
    }

    const metadata = payload.data.data?.attributes?.metadata;
    const userId = metadata?.['userId'];
    const plan = metadata?.['plan'];

    if (typeof userId !== 'string' || plan !== 'pro') {
      return { received: true, ignored: true };
    }

    await this.activatePaidPlan(userId);
    return { received: true };
  }

  async activateForUser(
    user: SessionUser,
    _plan: SubscriptionPlan = 'pro',
  ): Promise<SubscriptionState> {
    void _plan;
    this.assertMockEnabled();

    return this.activatePaidPlan(user.id, 'manual');
  }

  async cancelForUser(user: SessionUser): Promise<SubscriptionState> {
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

  private verifyPayMongoSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): void {
    const webhookSecret = this.config.subscription.paymongo.webhookSecret;

    if (!webhookSecret) {
      throw new ForbiddenException('Webhook secret not configured');
    }

    if (!rawBody || !signatureHeader) {
      throw new ForbiddenException('Missing webhook payload or signature');
    }

    // Header format: "t=<timestamp>,te=<test_sig>,li=<live_sig>"
    const parts = signatureHeader.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
    const teSignature = parts.find((p) => p.startsWith('te='))?.slice(3);
    const liSignature = parts.find((p) => p.startsWith('li='))?.slice(3);
    const expectedSig = teSignature ?? liSignature;

    if (!timestamp || !expectedSig) {
      throw new ForbiddenException('Invalid webhook signature format');
    }

    // Replay attack prevention: reject if timestamp is older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      throw new ForbiddenException('Webhook timestamp is expired');
    }

    const computed = createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const computedBuf = Buffer.from(computed, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');

    if (
      computedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(computedBuf, expectedBuf)
    ) {
      throw new ForbiddenException('Invalid PayMongo webhook signature');
    }
  }

  private assertPayMongoConfigured(): void {
    if (this.config.subscription.paymentProvider !== 'paymongo') {
      throw new ServiceUnavailableException('Payment service is unavailable');
    }

    if (!this.config.subscription.paymongo.secretKey) {
      throw new ServiceUnavailableException(
        'PayMongo secret key is not configured',
      );
    }
  }

  private paymongoHeaders(): HeadersInit {
    const token = Buffer.from(
      `${this.config.subscription.paymongo.secretKey}:`,
      'utf8',
    ).toString('base64');

    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async readPayMongoResponse(
    response: Response,
  ): Promise<PayMongoCheckoutSessionResponse> {
    const payload = (await response.json()) as PayMongoCheckoutSessionResponse;

    if (!response.ok) {
      throw new BadGatewayException({
        message: 'PayMongo request failed',
        status: response.status,
        paymongo: payload,
      });
    }

    return payload;
  }

  private async activatePaidPlan(
    userId: string,
    provider: 'manual' | 'paymongo' = 'paymongo',
  ): Promise<SubscriptionState> {
    const nextState = await this.subscriptionsRepository.activateMonthlyPlan(
      userId,
      'pro_monthly',
      this.config.subscription.proMonthlyPricePhp,
      provider,
    );

    await this.outboxRepository.publishLater({
      topic: 'subscription.activated',
      aggregateType: 'subscription',
      aggregateId: userId,
      payload: {
        userId,
        plan: nextState.plan,
        planCode: nextState.planCode,
      },
    });

    return nextState;
  }
}
