import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import { OAuthStateRepository } from '../persistence/oauth-state.repository.js';
import type { Request } from 'express';
import type {
  SessionUser,
  SubscriptionState,
} from '../../common/interfaces/session-user.interface.js';

const fakeUser: SessionUser = {
  id: 'user-1',
  login: 'testuser',
  email: 'test@example.com',
};

const fakeFreeSub: SubscriptionState = {
  plan: 'free',
  status: 'inactive',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeConfig = (withGitHub = true) =>
  ({
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
  ({
    publishLater: jest.fn().mockResolvedValue(undefined),
  }) as unknown as OutboxRepository;

/**
 * Default OAuthStateRepository mock: save() succeeds, findAndDelete() returns
 * a matching github record. Tests override these per-case as needed.
 */
const makeOAuthStateRepo = (overrides?: Partial<OAuthStateRepository>) =>
  ({
    save: jest.fn().mockResolvedValue(undefined),
    findAndDelete: jest.fn().mockResolvedValue({
      returnTo: 'http://localhost:3000',
      provider: 'github',
    }),
    ...overrides,
  }) as unknown as OAuthStateRepository;

const makeSession = (data: Record<string, unknown> = {}) => ({
  ...data,
  regenerate: jest
    .fn()
    .mockImplementation((cb: (err: null) => void) => cb(null)),
  destroy: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
  save: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
});

const makeRequest = (sessionData: Record<string, unknown> = {}) =>
  ({ session: makeSession(sessionData) }) as unknown as Request;

async function createService(
  withGitHub = true,
  oauthStateOverrides?: Partial<OAuthStateRepository>,
) {
  const usersRepo = makeUsersRepo();
  const subsRepo = makeSubsRepo();
  const outboxRepo = makeOutboxRepo();
  const oauthStateRepo = makeOAuthStateRepo(oauthStateOverrides);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: ConfigService, useValue: makeConfig(withGitHub) },
      { provide: UsersRepository, useValue: usersRepo },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
      { provide: OAuthStateRepository, useValue: oauthStateRepo },
    ],
  }).compile();

  return {
    service: module.get(AuthService),
    usersRepo,
    subsRepo,
    outboxRepo,
    oauthStateRepo,
  };
}

describe('AuthService', () => {
  describe('startGitHubAuth', () => {
    it('saves state to DB and returns GitHub authorization URL', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      const url = await service.startGitHubAuth(req);

      expect(url).toContain('github.com/login/oauth/authorize');
      expect(url).toContain('client_id=gh-client-id');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String), // uuid state
        'http://localhost:3000', // default returnTo
        'github',
      );
    });

    it('returns unavailable URL when GitHub credentials are missing', async () => {
      const { service } = await createService(false);
      const req = makeRequest();
      const url = await service.startGitHubAuth(req);
      expect(url).toContain('auth=unavailable');
    });

    it('normalizes relative returnTo paths and passes to DB save', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      const url = await service.startGitHubAuth(req, '/dashboard');

      expect(url).toContain('github.com');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        'http://localhost:3000/dashboard',
        'github',
      );
    });

    it('rejects returnTo URLs with different origin and falls back to frontendUrl', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      await service.startGitHubAuth(req, 'https://evil.com/steal');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        'http://localhost:3000', // evil.com rejected, fell back
        'github',
      );
    });

    it('does not write oauthState to session (DB is authoritative)', async () => {
      const { service } = await createService();
      const req = makeRequest();
      await service.startGitHubAuth(req);

      expect(
        (req.session as unknown as Record<string, unknown>).oauthState,
      ).toBeUndefined();
      expect(
        (req.session as unknown as Record<string, unknown>).oauthProvider,
      ).toBeUndefined();
    });
  });

  describe('handleGitHubCallback', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest
        .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
        .mockImplementation(jest.fn());
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('returns invalid_state when DB returns null (state not found / expired)', async () => {
      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue(null),
      });
      const req = makeRequest();
      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'unknown-state',
      );
      expect(url).toContain('auth=invalid_state');
    });

    it('returns invalid_state when code is missing', async () => {
      const { service } = await createService();
      const req = makeRequest();
      const url = await service.handleGitHubCallback(
        req,
        undefined,
        'state-abc',
      );
      expect(url).toContain('auth=invalid_state');
    });

    it('returns invalid_state when state is missing', async () => {
      const { service } = await createService();
      const req = makeRequest();
      const url = await service.handleGitHubCallback(req, 'code123', undefined);
      expect(url).toContain('auth=invalid_state');
    });

    it('returns invalid_state when DB record has wrong provider', async () => {
      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue({
          returnTo: 'http://localhost:3000',
          provider: 'google',
        }),
      });
      const req = makeRequest();
      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'state-abc',
      );
      expect(url).toContain('auth=invalid_state');
    });

    it('returns success after successful GitHub OAuth flow', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'gh-token-123' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 12345,
              login: 'testuser',
              name: 'Test User',
              email: 'test@example.com',
              avatar_url: 'https://example.com/avatar.png',
            }),
        } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );
      expect(url).toContain('auth=success');
    });

    it('returns failed when token exchange fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );
      expect(url).toContain('auth=failed');
    });

    it('fetches primary email when profile email is null', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'gh-token' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              login: 'user',
              name: 'User',
              email: null,
            }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { email: 'primary@example.com', primary: true, verified: true },
            ]),
        } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest();

      const url = await service.handleGitHubCallback(req, 'c1', 's1');
      expect(url).toContain('auth=success');
    });

    it('uses returnTo from DB record when redirecting', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'gh-token-123' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              login: 'user',
              name: 'User',
              email: 'u@example.com',
            }),
        } as unknown as Response);

      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue({
          returnTo: 'http://localhost:3000/dashboard',
          provider: 'github',
        }),
      });
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'state-xyz',
      );
      expect(url).toContain('http://localhost:3000/dashboard');
      expect(url).toContain('auth=success');
    });
  });

  describe('logout', () => {
    it('destroys the session', async () => {
      const { service } = await createService();
      const req = makeRequest();
      await service.logout(req);
      expect(
        (req.session as unknown as { destroy: jest.Mock }).destroy,
      ).toHaveBeenCalled();
    });

    it('rejects when session.destroy returns an error', async () => {
      const { service } = await createService();
      const req = makeRequest();
      (req.session as unknown as { destroy: jest.Mock }).destroy = jest
        .fn()
        .mockImplementation((cb: (err: Error) => void) =>
          cb(new Error('session error')),
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
