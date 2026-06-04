import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from './subscription.service.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import type { SessionUser, SubscriptionState } from '../../common/interfaces/session-user.interface.js';

const fakeUser: SessionUser = { id: 'user-1', login: 'testuser' };

const fakeFreeSub: SubscriptionState = {
  plan: 'free',
  status: 'inactive',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
  planCode: 'free',
};

const fakeProSub: SubscriptionState = {
  plan: 'pro',
  status: 'active',
  provider: 'manual',
  updatedAt: '2026-01-01T00:00:00Z',
  planCode: 'pro_monthly',
  amountPhp: 300,
};

const makeConfig = (overrides: Partial<{
  mockEnabled: boolean;
  defaultPlan: string;
  seededPlans: Record<string, string>;
  paymentProvider: string;
  paymongoSecretKey: string;
}> = {}) => ({
  getOrThrow: jest.fn().mockReturnValue({
    subscription: {
      mockEnabled: overrides.mockEnabled ?? false,
      defaultPlan: overrides.defaultPlan ?? 'free',
      seededPlans: overrides.seededPlans ?? {},
      proMonthlyPricePhp: 300,
      paymentProvider: overrides.paymentProvider ?? 'none',
      successUrl: 'http://localhost:3000/subscribe?status=success',
      cancelUrl: 'http://localhost:3000/subscribe?status=cancelled',
      paymongo: {
        secretKey: overrides.paymongoSecretKey ?? '',
        webhookSecret: 'whsec_test_123',
      },
    },
    frontendUrl: 'http://localhost:3000',
  }),
}) as unknown as ConfigService;

const makeSubsRepo = () =>
  ({
    getCurrentByUserId: jest.fn().mockResolvedValue(null),
    ensureDefaultFreeSubscription: jest.fn().mockResolvedValue(fakeFreeSub),
    activateMonthlyPlan: jest.fn().mockResolvedValue(fakeProSub),
    cancelCurrent: jest.fn().mockResolvedValue(fakeFreeSub),
  }) as unknown as SubscriptionsRepository;

const makeOutboxRepo = () =>
  ({ publishLater: jest.fn().mockResolvedValue(undefined) }) as unknown as OutboxRepository;

async function createService(
  configOverrides: Parameters<typeof makeConfig>[0] = {},
) {
  const subsRepo = makeSubsRepo();
  const outboxRepo = makeOutboxRepo();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SubscriptionService,
      { provide: ConfigService, useValue: makeConfig(configOverrides) },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
    ],
  }).compile();

  return {
    service: module.get(SubscriptionService),
    subsRepo,
    outboxRepo,
  };
}

describe('SubscriptionService', () => {
  let fetchMock: jest.Mock;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('getForUser', () => {
    it('returns existing subscription when one exists', async () => {
      const { service, subsRepo } = await createService();
      (subsRepo.getCurrentByUserId as jest.Mock).mockResolvedValueOnce(fakeProSub);

      const result = await service.getForUser(fakeUser);
      expect(result.plan).toBe('pro');
    });

    it('returns free subscription by default', async () => {
      const { service } = await createService();
      const result = await service.getForUser(fakeUser);
      expect(result.plan).toBe('free');
    });

    it('activates pro plan for seeded user by login', async () => {
      const { service, subsRepo } = await createService({
        seededPlans: { testuser: 'pro' },
      });

      const result = await service.getForUser(fakeUser);
      expect(subsRepo.activateMonthlyPlan).toHaveBeenCalledWith(
        'user-1',
        'pro_monthly',
        300,
        'manual',
      );
      expect(result.plan).toBe('pro');
    });
  });

  describe('createCheckoutSession', () => {
    it('throws ServiceUnavailableException when payment provider is not configured', async () => {
      const { service } = await createService();
      await expect(service.createCheckoutSession(fakeUser, 'pro')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('creates a PayMongo hosted checkout session for Pro Monthly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'cs_paymongo_123',
            attributes: {
              status: 'active',
              checkout_url: 'https://checkout.paymongo.com/cs_paymongo_123',
              metadata: { userId: 'user-1', plan: 'pro' },
            },
          },
        }),
      } as unknown as Response);

      const { service } = await createService({
        paymentProvider: 'paymongo',
        paymongoSecretKey: 'sk_test_123',
      });

      const result = await service.createCheckoutSession(fakeUser, 'pro');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.paymongo.com/v2/checkout_sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toMatchObject({
        data: {
          attributes: {
            line_items: [
              {
                currency: 'PHP',
                amount: 30000,
                name: 'FlowCI Studio Pro Monthly',
                quantity: 1,
              },
            ],
            success_url: 'http://localhost:3000/subscribe?status=success',
            cancel_url: 'http://localhost:3000/subscribe?status=cancelled',
            payment_method_types: ['card', 'gcash', 'qrph'],
            metadata: { userId: 'user-1', plan: 'pro' },
          },
        },
      });
      expect(result).toEqual({
        checkoutId: 'cs_paymongo_123',
        status: 'active',
        redirectUrl: 'https://checkout.paymongo.com/cs_paymongo_123',
        metadata: { userId: 'user-1', plan: 'pro' },
      });
    });
  });

  describe('getCheckoutStatus', () => {
    it('activates Pro after a paid PayMongo checkout session', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'cs_paymongo_123',
            attributes: {
              status: 'paid',
              metadata: { userId: 'user-1', plan: 'pro' },
            },
          },
        }),
      } as unknown as Response);

      const { service, subsRepo, outboxRepo } = await createService({
        paymentProvider: 'paymongo',
        paymongoSecretKey: 'sk_test_123',
      });

      const result = await service.getCheckoutStatus(fakeUser, 'cs_paymongo_123');

      expect(subsRepo.activateMonthlyPlan).toHaveBeenCalledWith(
        'user-1',
        'pro_monthly',
        300,
        'paymongo',
      );
      expect(outboxRepo.publishLater).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'subscription.activated' }),
      );
      expect(result.status).toBe('paid');
      expect(result.subscription?.plan).toBe('pro');
    });
  });

  describe('handlePayMongoWebhook', () => {
    it('activates Pro when PayMongo sends a paid checkout webhook', async () => {
      const { service, subsRepo, outboxRepo } = await createService({
        paymentProvider: 'paymongo',
        paymongoSecretKey: 'sk_test_123',
      });

      await expect(
        service.handlePayMongoWebhook({
          data: {
            type: 'checkout_session.payment.paid',
            data: {
              attributes: {
                metadata: { userId: 'user-1', plan: 'pro' },
              },
            },
          },
        }, 'whsec_test_123'),
      ).resolves.toEqual({ received: true });

      expect(subsRepo.activateMonthlyPlan).toHaveBeenCalledWith(
        'user-1',
        'pro_monthly',
        300,
        'paymongo',
      );
      expect(outboxRepo.publishLater).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'subscription.activated' }),
      );
    });
  });

  describe('activateForUser', () => {
    it('throws ForbiddenException when mock is disabled', async () => {
      const { service } = await createService({ mockEnabled: false });
      await expect(service.activateForUser(fakeUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('activates pro plan and publishes event', async () => {
      const { service, outboxRepo } = await createService({ mockEnabled: true });
      const result = await service.activateForUser(fakeUser, 'pro');

      expect(result.plan).toBe('pro');
      expect(outboxRepo.publishLater).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'subscription.activated' }),
      );
    });
  });

  describe('cancelForUser', () => {
    it('throws ForbiddenException when mock is disabled', async () => {
      const { service } = await createService({ mockEnabled: false });
      await expect(service.cancelForUser(fakeUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('cancels and publishes event', async () => {
      const { service, outboxRepo } = await createService({ mockEnabled: true });
      await service.cancelForUser(fakeUser);

      expect(outboxRepo.publishLater).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'subscription.canceled' }),
      );
    });
  });
});
