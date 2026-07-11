import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type { HostedCheckoutPaymentMethod } from './dto/create-checkout.dto';
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

interface PayMongoPaymentIntentResponse {
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      client_key?: string;
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
        payment_intent_id?: string;
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
    if (this.config.subscription.gateEnabled === false) {
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

  // PayMongo owns payment credential tokenization; AlphaCI only creates intents/sessions and confirms status/webhooks.
  // Card numbers and wallet credentials never pass through this backend.
  async createCheckoutSession(
    user: SessionUser,
    plan: 'pro',
    paymentMethod?: HostedCheckoutPaymentMethod,
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
                  name: 'AlphaCI Starter Monthly',
                  quantity: 1,
                },
              ],
              payment_method_types:
                this.getCheckoutPaymentMethodTypes(paymentMethod),
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

    const payload =
      await this.readPayMongoResponse<PayMongoCheckoutSessionResponse>(
        response,
      );
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
    const payload =
      await this.readPayMongoResponse<PayMongoCheckoutSessionResponse>(
        response,
      );
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

  async createPaymentIntent(
    user: SessionUser,
    plan: 'pro',
    paymentMethod: 'card' | 'gcash' | 'paymaya' | 'qrph' = 'card',
  ): Promise<{ paymentIntentId: string; clientKey: string; status: string }> {
    this.assertPayMongoConfigured();

    const amountPhp = this.config.subscription.proMonthlyPricePhp;
    const response = await fetch(
      'https://api.paymongo.com/v1/payment_intents',
      {
        method: 'POST',
        headers: this.paymongoHeaders(),
        body: JSON.stringify({
          data: {
            attributes: {
              amount: amountPhp * 100,
              currency: 'PHP',
              payment_method_allowed: [paymentMethod],
              description: 'AlphaCI Starter Monthly',
              statement_descriptor: 'AlphaCI',
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

    const payload =
      await this.readPayMongoResponse<PayMongoPaymentIntentResponse>(response);
    const data = payload.data;

    if (!data?.id || !data.attributes?.client_key) {
      throw new BadGatewayException(
        'PayMongo payment intent response did not include client details',
      );
    }

    return {
      paymentIntentId: data.id,
      clientKey: data.attributes.client_key,
      status: data.attributes.status ?? 'awaiting_payment_method',
    };
  }

  async cancelPaymentIntent(
    user: SessionUser,
    paymentIntentId: string,
  ): Promise<{ status: string }> {
    this.assertPayMongoConfigured();

    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    const metadataUserId = paymentIntent.attributes?.metadata?.['userId'];
    if (typeof metadataUserId !== 'string' || metadataUserId !== user.id) {
      throw new ForbiddenException(
        'Payment intent does not belong to this user',
      );
    }

    if (paymentIntent.attributes?.status === 'succeeded') {
      return { status: 'succeeded' };
    }

    const response = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
      {
        method: 'POST',
        headers: this.paymongoHeaders(),
      },
    );
    const payload =
      await this.readPayMongoResponse<PayMongoPaymentIntentResponse>(response);
    return {
      status: payload.data?.attributes?.status ?? 'awaiting_payment_method',
    };
  }

  async getPaymentIntentStatus(
    user: SessionUser,
    paymentIntentId: string,
  ): Promise<{ status: string; subscription?: SubscriptionState }> {
    this.assertPayMongoConfigured();

    const response = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      {
        headers: this.paymongoHeaders(),
      },
    );
    const payload =
      await this.readPayMongoResponse<PayMongoPaymentIntentResponse>(response);
    const attributes = payload.data?.attributes;
    const status = attributes?.status ?? 'unknown';

    if (status !== 'succeeded') {
      return { status };
    }

    const metadataUserId = attributes?.metadata?.['userId'];
    if (typeof metadataUserId === 'string' && metadataUserId !== user.id) {
      throw new ForbiddenException(
        'Payment intent does not belong to this user',
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
    const eventType = payload.data?.type;

    if (eventType === 'checkout_session.payment.paid') {
      const metadata = payload.data?.data?.attributes?.metadata;
      const userId = metadata?.['userId'];
      const plan = metadata?.['plan'];

      if (typeof userId !== 'string' || plan !== 'pro') {
        return { received: true, ignored: true };
      }

      await this.activatePaidPlan(userId);
      return { received: true };
    }

    if (eventType === 'payment.paid') {
      const paymentIntentId = payload.data?.data?.attributes?.payment_intent_id;
      if (typeof paymentIntentId !== 'string') {
        return { received: true, ignored: true };
      }

      const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
      const metadata = paymentIntent.attributes?.metadata;
      const userId = metadata?.['userId'];
      const plan = metadata?.['plan'];

      if (
        paymentIntent.attributes?.status !== 'succeeded' ||
        typeof userId !== 'string' ||
        plan !== 'pro'
      ) {
        return { received: true, ignored: true };
      }

      await this.activatePaidPlan(userId);
      return { received: true };
    }

    return { received: true, ignored: true };
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

  private getCheckoutPaymentMethodTypes(
    paymentMethod?: HostedCheckoutPaymentMethod,
  ): string[] {
    if (paymentMethod === 'ewallets') return ['gcash', 'paymaya'];
    if (paymentMethod === 'gcash') return ['gcash'];
    if (paymentMethod === 'maya' || paymentMethod === 'paymaya')
      return ['paymaya'];
    if (paymentMethod === 'qrph') return ['qrph'];
    return ['card', 'gcash', 'qrph'];
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

  private async retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<NonNullable<PayMongoPaymentIntentResponse['data']>> {
    const response = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      { headers: this.paymongoHeaders() },
    );
    const payload =
      await this.readPayMongoResponse<PayMongoPaymentIntentResponse>(response);
    if (!payload.data) {
      throw new BadGatewayException(
        'PayMongo payment intent response did not include payment data',
      );
    }
    return payload.data;
  }
  private async readPayMongoResponse<
    T extends PayMongoCheckoutSessionResponse | PayMongoPaymentIntentResponse,
  >(response: Response): Promise<T> {
    const payload = (await response.json()) as T;

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
