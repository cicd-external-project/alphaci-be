import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TribeClient } from '@implementsprint/sdk';
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
}> = {}) => ({
  getOrThrow: jest.fn().mockReturnValue({
    subscription: {
      mockEnabled: overrides.mockEnabled ?? false,
      defaultPlan: overrides.defaultPlan ?? 'free',
      seededPlans: overrides.seededPlans ?? {},
      proMonthlyPricePhp: 300,
      enterpriseMonthlyPricePhp: 1200,
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

const makeApiCenter = () =>
  ({
    paymentCreateCheckoutSession: jest.fn().mockResolvedValue({
      checkoutId: 'cs_test_123',
      status: 'pending',
      redirectUrl: 'https://checkout.paymongo.com/test',
    }),
    paymentGetCheckoutSession: jest.fn().mockResolvedValue({
      checkoutId: 'cs_test_123',
      status: 'pending',
      metadata: { userId: 'user-1', plan: 'pro' },
    }),
  }) as unknown as TribeClient;

async function createService(
  configOverrides: Parameters<typeof makeConfig>[0] = {},
  withApiCenter = true,
) {
  const apiCenter = withApiCenter ? makeApiCenter() : null;
  const subsRepo = makeSubsRepo();
  const outboxRepo = makeOutboxRepo();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SubscriptionService,
      { provide: ConfigService, useValue: makeConfig(configOverrides) },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
      { provide: TribeClient, useValue: apiCenter },
    ],
  }).compile();

  return {
    service: module.get(SubscriptionService),
    subsRepo,
    outboxRepo,
    apiCenter,
  };
}

describe('SubscriptionService', () => {
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

    it('activates enterprise plan for seeded user by id', async () => {
      const { service, subsRepo } = await createService({
        seededPlans: { 'user-1': 'enterprise' },
      });

      await service.getForUser(fakeUser);
      expect(subsRepo.activateMonthlyPlan).toHaveBeenCalledWith(
        'user-1',
        'enterprise_monthly',
        1200,
        'manual',
      );
    });
  });

  describe('createCheckoutSession', () => {
    it('throws ServiceUnavailableException when apiCenter is null', async () => {
      const { service } = await createService({}, false);
      await expect(service.createCheckoutSession(fakeUser, 'pro')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('creates a pro checkout session', async () => {
      const { service, apiCenter } = await createService();
      const result = await service.createCheckoutSession(fakeUser, 'pro');

      expect(apiCenter!.paymentCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({ amount: { value: 30000, currency: 'PHP' } }),
          ]),
          metadata: { userId: 'user-1', plan: 'pro' },
        }),
      );
      expect((result as { checkoutId?: string }).checkoutId).toBe('cs_test_123');
    });

    it('creates an enterprise checkout session', async () => {
      const { service, apiCenter } = await createService();
      await service.createCheckoutSession(fakeUser, 'enterprise');

      expect(apiCenter!.paymentCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({ amount: { value: 120000, currency: 'PHP' } }),
          ]),
        }),
      );
    });
  });

  describe('getCheckoutStatus', () => {
    it('throws ServiceUnavailableException when apiCenter is null', async () => {
      const { service } = await createService({}, false);
      await expect(service.getCheckoutStatus(fakeUser, 'cs_123')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ForbiddenException when userId does not match', async () => {
      const { service, apiCenter } = await createService();
      (apiCenter!.paymentGetCheckoutSession as jest.Mock).mockResolvedValueOnce({
        status: 'pending',
        metadata: { userId: 'other-user', plan: 'pro' },
      });

      await expect(service.getCheckoutStatus(fakeUser, 'cs_123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns pending status', async () => {
      const { service } = await createService();
      const result = await service.getCheckoutStatus(fakeUser, 'cs_123');
      expect(result.status).toBe('pending');
    });

    it('activates subscription and publishes event when paid', async () => {
      const { service, apiCenter, subsRepo, outboxRepo } = await createService();
      (apiCenter!.paymentGetCheckoutSession as jest.Mock).mockResolvedValueOnce({
        status: 'paid',
        metadata: { userId: 'user-1', plan: 'pro' },
      });

      const result = await service.getCheckoutStatus(fakeUser, 'cs_123');

      expect(result.status).toBe('paid');
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

    it('throws when paid plan metadata is invalid', async () => {
      const { service, apiCenter } = await createService();
      (apiCenter!.paymentGetCheckoutSession as jest.Mock).mockResolvedValueOnce({
        status: 'paid',
        metadata: { userId: 'user-1', plan: 'invalid-plan' },
      });

      await expect(service.getCheckoutStatus(fakeUser, 'cs_123')).rejects.toThrow(
        /Unexpected plan value/,
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

    it('activates enterprise plan', async () => {
      const { service, subsRepo } = await createService({ mockEnabled: true });
      await service.activateForUser(fakeUser, 'enterprise');

      expect(subsRepo.activateMonthlyPlan).toHaveBeenCalledWith(
        'user-1',
        'enterprise_monthly',
        1200,
        'manual',
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
