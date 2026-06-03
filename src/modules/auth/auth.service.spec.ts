import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import type { Request } from 'express';
import type { SessionUser, SubscriptionState } from '../../common/interfaces/session-user.interface.js';

const fakeUser: SessionUser = { id: 'user-1', login: 'testuser', email: 'test@example.com' };

const fakeFreeSub: SubscriptionState = {
  plan: 'free',
  status: 'inactive',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeConfig = (withGitHub = true) => ({
  getOrThrow: jest.fn().mockReturnValue({
    frontendUrl: 'http://localhost:3000',
    github: {
      clientId: withGitHub ? 'gh-client-id' : '',
      clientSecret: withGitHub ? 'gh-client-secret' : '',
      callbackUrl: 'http://localhost:4000/api/v1/auth/github/callback',
      scope: 'read:user user:email',
    },
  }),
}) as unknown as ConfigService;

const makeUsersRepo = () =>
  ({
    upsertGitHubUser: jest.fn().mockResolvedValue(fakeUser),
    findById: jest.fn().mockResolvedValue(fakeUser),
  }) as unknown as UsersRepository;

const makeSubsRepo = () =>
  ({
    ensureDefaultFreeSubscription: jest.fn().mockResolvedValue(fakeFreeSub),
  }) as unknown as SubscriptionsRepository;

const makeOutboxRepo = () =>
  ({ publishLater: jest.fn().mockResolvedValue(undefined) }) as unknown as OutboxRepository;

const makeSession = (data: Record<string, unknown> = {}) => ({
  ...data,
  regenerate: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
  destroy: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
  save: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
});

const makeRequest = (sessionData: Record<string, unknown> = {}) =>
  ({ session: makeSession(sessionData) }) as unknown as Request;

async function createService(withGitHub = true) {
  const usersRepo = makeUsersRepo();
  const subsRepo = makeSubsRepo();
  const outboxRepo = makeOutboxRepo();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: ConfigService, useValue: makeConfig(withGitHub) },
      { provide: UsersRepository, useValue: usersRepo },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
    ],
  }).compile();

  return {
    service: module.get(AuthService),
    usersRepo,
    subsRepo,
    outboxRepo,
  };
}

describe('AuthService', () => {
  describe('startGitHubAuth', () => {
    it('returns auth URL and sets session state', () => {
      createService().then(({ service }) => {
        const req = makeRequest();
        const url = service.startGitHubAuth(req);

        expect(url).toContain('github.com/login/oauth/authorize');
        expect(url).toContain('client_id=gh-client-id');
        expect((req.session as Record<string, unknown>).oauthProvider).toBe('github');
      });
    });

    it('returns unavailable URL when GitHub credentials are missing', async () => {
      const { service } = await createService(false);
      const req = makeRequest();
      const url = service.startGitHubAuth(req);
      expect(url).toContain('auth=unavailable');
    });

    it('normalizes relative returnTo paths', async () => {
      const { service } = await createService();
      const req = makeRequest();
      const url = service.startGitHubAuth(req, '/dashboard');
      expect(url).toContain('github.com');
      expect((req.session as Record<string, unknown>).oauthReturnTo).toBe(
        'http://localhost:3000/dashboard',
      );
    });

    it('rejects returnTo URLs with different origin', async () => {
      const { service } = await createService();
      const req = makeRequest();
      service.startGitHubAuth(req, 'https://evil.com/steal');
      expect((req.session as Record<string, unknown>).oauthReturnTo).toBe(
        'http://localhost:3000',
      );
    });
  });

  describe('handleGitHubCallback', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest.spyOn(global, 'fetch' as keyof typeof global).mockImplementation(
        jest.fn() as jest.Mock,
      );
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('returns invalid_state when state mismatch', async () => {
      const { service } = await createService();
      const req = makeRequest({ oauthState: 'correct-state', oauthProvider: 'github', oauthReturnTo: 'http://localhost:3000' });
      const url = await service.handleGitHubCallback(req, 'code123', 'wrong-state');
      expect(url).toContain('auth=invalid_state');
    });

    it('returns invalid_state when code is missing', async () => {
      const { service } = await createService();
      const req = makeRequest({ oauthState: 'state-abc', oauthProvider: 'github', oauthReturnTo: 'http://localhost:3000' });
      const url = await service.handleGitHubCallback(req, undefined, 'state-abc');
      expect(url).toContain('auth=invalid_state');
    });

    it('returns success after successful GitHub OAuth flow', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'gh-token-123' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 12345,
            login: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
            avatar_url: 'https://example.com/avatar.png',
          }),
        } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest({
        oauthState: 'valid-state',
        oauthProvider: 'github',
        oauthReturnTo: 'http://localhost:3000',
      });

      const url = await service.handleGitHubCallback(req, 'code123', 'valid-state');
      expect(url).toContain('auth=success');
    });

    it('returns failed when token exchange fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest({
        oauthState: 'valid-state',
        oauthProvider: 'github',
        oauthReturnTo: 'http://localhost:3000',
      });

      const url = await service.handleGitHubCallback(req, 'code123', 'valid-state');
      expect(url).toContain('auth=failed');
    });

    it('fetches primary email when profile email is null', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'gh-token' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 1, login: 'user', name: 'User', email: null }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ email: 'primary@example.com', primary: true, verified: true }],
        } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest({
        oauthState: 's1',
        oauthProvider: 'github',
        oauthReturnTo: 'http://localhost:3000',
      });

      const url = await service.handleGitHubCallback(req, 'c1', 's1');
      expect(url).toContain('auth=success');
    });
  });

  describe('logout', () => {
    it('destroys the session', async () => {
      const { service } = await createService();
      const req = makeRequest();
      await service.logout(req);
      expect((req.session as { destroy: jest.Mock }).destroy).toHaveBeenCalled();
    });

    it('rejects when session.destroy returns an error', async () => {
      const { service } = await createService();
      const req = makeRequest();
      (req.session as { destroy: jest.Mock }).destroy = jest.fn().mockImplementation(
        (cb: (err: Error) => void) => cb(new Error('session error')),
      );

      await expect(service.logout(req)).rejects.toThrow('session error');
    });
  });

  describe('getSessionUser', () => {
    it('returns user from session.user directly', async () => {
      const { service } = await createService();
      const req = makeRequest({ user: fakeUser });
      const result = await service.getSessionUser(req);
      expect(result).toEqual(fakeUser);
    });

    it('returns null when no userId in session', async () => {
      const { service } = await createService();
      const req = makeRequest({});
      const result = await service.getSessionUser(req);
      expect(result).toBeNull();
    });

    it('loads user from DB when userId is in session but user object is missing', async () => {
      const { service } = await createService();
      const req = makeRequest({ userId: 'user-1' });
      const result = await service.getSessionUser(req);
      expect(result).toEqual(fakeUser);
    });
  });
});
