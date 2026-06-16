import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import { OAuthStateRepository } from '../persistence/oauth-state.repository.js';
import { ExampleProjectSeederService } from '../projects/example-project-seeder.service.js';
import type { Request } from 'express';
import type {
  SessionUser,
  SubscriptionState,
} from '../../common/interfaces/session-user.interface.js';
import type { ArchivedUserLookup } from '../persistence/users.repository.js';

const fakeUser: SessionUser = {
  id: 'user-1',
  login: 'testuser',
  email: 'test@example.com',
  onboardingCompleted: false,
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
      archivedAccountRetentionDays: 30,
      github: {
        clientId: withGitHub ? 'gh-client-id' : '',
        clientSecret: withGitHub ? 'gh-client-secret' : '',
        callbackUrl: 'http://localhost:4000/api/v1/auth/github/callback',
        scope: 'read:user user:email',
      },
    }),
  }) as unknown as ConfigService;

const makeUsersRepo = (overrides?: Partial<UsersRepository>) =>
  ({
    upsertGitHubUser: jest.fn().mockResolvedValue(fakeUser),
    findById: jest.fn().mockResolvedValue(fakeUser),
    archiveById: jest.fn().mockResolvedValue(undefined),
    deleteById: jest.fn().mockResolvedValue(undefined),
    hardDeleteByGithubUserId: jest.fn().mockResolvedValue(undefined),
    findByGithubUserIdIncludingArchived: jest.fn().mockResolvedValue(null),
    restoreByGithubUserId: jest.fn().mockResolvedValue(fakeUser),
    markOnboardingComplete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as UsersRepository;

const makeSubsRepo = () =>
  ({
    ensureDefaultFreeSubscription: jest.fn().mockResolvedValue(fakeFreeSub),
  }) as unknown as SubscriptionsRepository;

const makeOutboxRepo = () =>
  ({
    publishLater: jest.fn().mockResolvedValue(undefined),
  }) as unknown as OutboxRepository;

const makeExampleProjectSeederService = (
  overrides?: Partial<ExampleProjectSeederService>,
) =>
  ({
    ensureExampleProjectSeeded: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ExampleProjectSeederService;

/**
 * Default OAuthStateRepository mock: save() succeeds, findAndDelete() returns
 * a matching github record. Tests override these per-case as needed.
 */
const makeOAuthStateRepo = (overrides?: Partial<OAuthStateRepository>) =>
  ({
    save: jest.fn().mockResolvedValue(undefined),
    pruneExpired: jest.fn().mockResolvedValue(0),
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
  usersRepoOverrides?: Partial<UsersRepository>,
  exampleProjectSeederOverrides?: Partial<ExampleProjectSeederService>,
) {
  const usersRepo = makeUsersRepo(usersRepoOverrides);
  const subsRepo = makeSubsRepo();
  const outboxRepo = makeOutboxRepo();
  const oauthStateRepo = makeOAuthStateRepo(oauthStateOverrides);
  const exampleProjectSeederService = makeExampleProjectSeederService(
    exampleProjectSeederOverrides,
  );

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: ConfigService, useValue: makeConfig(withGitHub) },
      { provide: UsersRepository, useValue: usersRepo },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
      { provide: OAuthStateRepository, useValue: oauthStateRepo },
      {
        provide: ExampleProjectSeederService,
        useValue: exampleProjectSeederService,
      },
    ],
  }).compile();

  return {
    service: module.get(AuthService),
    usersRepo,
    subsRepo,
    outboxRepo,
    oauthStateRepo,
    exampleProjectSeederService,
  };
}

// Helper: build a fetchMock sequence for a successful GitHub OAuth flow.
// Provides: access_token response → user profile response.
function mockSuccessfulGitHubFetch(
  fetchMock: jest.SpyInstance,
  profile: Partial<GitHubProfilePayload> = {},
) {
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
          ...profile,
        }),
    } as unknown as Response);
}

interface GitHubProfilePayload {
  id: number;
  login: string;
  name?: string;
  email?: string | null;
  avatar_url?: string;
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

    it('returns success after successful GitHub OAuth flow (new user)', async () => {
      mockSuccessfulGitHubFetch(fetchMock);
      // findByGithubUserIdIncludingArchived returns null → new user path
      const { service, exampleProjectSeederService } = await createService(
        true,
        undefined,
        {
          findByGithubUserIdIncludingArchived: jest
            .fn()
            .mockResolvedValue(null),
        },
      );
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );
      expect(url).toContain('auth=success');
      // Demo project seeding runs for brand-new accounts.
      expect(
        exampleProjectSeederService.ensureExampleProjectSeeded,
      ).toHaveBeenCalledWith('user-1');
    });

    it('returns success after successful GitHub OAuth flow (active existing user)', async () => {
      mockSuccessfulGitHubFetch(fetchMock);
      const activeRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt: null,
        githubUserId: '12345',
      };
      const { service, exampleProjectSeederService } = await createService(
        true,
        undefined,
        {
          findByGithubUserIdIncludingArchived: jest
            .fn()
            .mockResolvedValue(activeRow),
        },
      );
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );
      expect(url).toContain('auth=success');
      // Demo project seeding must NOT run again for an already-active account.
      expect(
        exampleProjectSeederService.ensureExampleProjectSeeded,
      ).not.toHaveBeenCalled();
    });

    it('does not block login when example project seeding rejects', async () => {
      mockSuccessfulGitHubFetch(fetchMock);
      const { service } = await createService(
        true,
        undefined,
        {
          findByGithubUserIdIncludingArchived: jest
            .fn()
            .mockResolvedValue(null),
        },
        {
          ensureExampleProjectSeeded: jest
            .fn()
            .mockRejectedValue(new Error('seeding boom')),
        },
      );
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );

      // Even though the seeder rejected, login must still succeed. In
      // production ExampleProjectSeederService never rejects (it catches
      // internally); this test simulates a worst-case to prove the auth
      // flow's own try/catch around resolveAccountState/establishSession
      // does not depend on seeding succeeding.
      expect(url).toContain('auth=success');
    });

    it('sets pendingArchived and returns archived_choice for a returning archived user', async () => {
      mockSuccessfulGitHubFetch(fetchMock);

      const archivedRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt: '2026-05-01T00:00:00Z',
        githubUserId: '12345',
      };
      const { service } = await createService(true, undefined, {
        findByGithubUserIdIncludingArchived: jest
          .fn()
          .mockResolvedValue(archivedRow),
      });

      const session = makeSession();
      const req = { session } as unknown as Request;

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=archived_choice');

      // Session must have pendingArchived but NOT userId or user.
      const s = session as unknown as Record<string, unknown>;
      expect(s['pendingArchived']).toBeDefined();
      expect(
        (s['pendingArchived'] as Record<string, unknown>)['githubUserId'],
      ).toBe('12345');
      expect(s['userId']).toBeUndefined();
      expect(s['user']).toBeUndefined();
    });

    it('does NOT call upsertGitHubUser for archived accounts', async () => {
      mockSuccessfulGitHubFetch(fetchMock);

      const archivedRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt: '2026-05-01T00:00:00Z',
        githubUserId: '12345',
      };
      const upsertSpy = jest.fn().mockResolvedValue(fakeUser);
      const { service } = await createService(true, undefined, {
        findByGithubUserIdIncludingArchived: jest
          .fn()
          .mockResolvedValue(archivedRow),
        upsertGitHubUser: upsertSpy,
      });

      const req = makeRequest();
      await service.handleGitHubCallback(req, 'code123', 'valid-state');

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('does NOT call ensureDefaultFreeSubscription or publishLater for archived accounts', async () => {
      mockSuccessfulGitHubFetch(fetchMock);

      const archivedRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt: '2026-05-01T00:00:00Z',
        githubUserId: '12345',
      };
      const { service, subsRepo, outboxRepo, exampleProjectSeederService } =
        await createService(true, undefined, {
          findByGithubUserIdIncludingArchived: jest
            .fn()
            .mockResolvedValue(archivedRow),
        });

      const req = makeRequest();
      await service.handleGitHubCallback(req, 'code123', 'valid-state');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(subsRepo.ensureDefaultFreeSubscription).not.toHaveBeenCalled();
      expect(
        exampleProjectSeederService.ensureExampleProjectSeeded,
      ).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(outboxRepo.publishLater).not.toHaveBeenCalled();
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
      mockSuccessfulGitHubFetch(fetchMock);

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

  describe('deleteAccount', () => {
    it('calls archiveById (not deleteById or hardDeleteByGithubUserId) and destroys session', async () => {
      const { service, usersRepo } = await createService();
      const req = makeRequest({ userId: 'user-1' });

      await service.deleteAccount(req);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.archiveById).toHaveBeenCalledWith('user-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.deleteById).not.toHaveBeenCalled();
      expect(
        (req.session as unknown as { destroy: jest.Mock }).destroy,
      ).toHaveBeenCalled();
    });

    it('prefers session.userId over session.user.id', async () => {
      const { service, usersRepo } = await createService();
      const req = makeRequest({
        userId: 'from-userId',
        user: { ...fakeUser, id: 'from-user-obj' },
      });

      await service.deleteAccount(req);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.archiveById).toHaveBeenCalledWith('from-userId');
    });

    it('does nothing when no userId is in session', async () => {
      const { service, usersRepo } = await createService();
      const req = makeRequest({});

      await service.deleteAccount(req);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.archiveById).not.toHaveBeenCalled();
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

  describe('getPendingArchivedAccount', () => {
    it('returns { pending: false } when no pendingArchived in session', async () => {
      const { service } = await createService();
      const req = makeRequest({});
      const result = await service.getPendingArchivedAccount(req);
      expect(result).toEqual({ pending: false });
    });

    it('returns { pending: false } when row is no longer archived', async () => {
      // Row was restored in another tab — archivedAt is now null.
      const activeRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt: null,
        githubUserId: '12345',
      };
      const { service } = await createService(true, undefined, {
        findByGithubUserIdIncludingArchived: jest
          .fn()
          .mockResolvedValue(activeRow),
      });

      const req = makeRequest({
        pendingArchived: {
          githubUserId: '12345',
          login: 'testuser',
          accessToken: 'tok',
        },
      });

      const result = await service.getPendingArchivedAccount(req);
      expect(result).toEqual({ pending: false });
    });

    it('returns pending info with computed purgeAt when row is still archived', async () => {
      const archivedAt = '2026-05-01T00:00:00.000Z';
      const archivedRow: ArchivedUserLookup = {
        id: 'user-1',
        login: 'testuser',
        archivedAt,
        githubUserId: '12345',
      };
      const { service } = await createService(true, undefined, {
        findByGithubUserIdIncludingArchived: jest
          .fn()
          .mockResolvedValue(archivedRow),
      });

      const req = makeRequest({
        pendingArchived: {
          githubUserId: '12345',
          login: 'testuser',
          accessToken: 'tok',
        },
      });

      const result = await service.getPendingArchivedAccount(req);
      expect(result).toMatchObject({
        pending: true,
        login: 'testuser',
        archivedAt,
        retentionDays: 30,
      });
      // purgeAt = archivedAt + 30 days
      if (result.pending) {
        const purge = new Date(result.purgeAt);
        const expected = new Date(archivedAt);
        expected.setDate(expected.getDate() + 30);
        expect(purge.toISOString()).toBe(expected.toISOString());
      }
    });
  });

  describe('restoreArchivedAccount', () => {
    it('throws UnauthorizedException when no pendingArchived in session', async () => {
      const { service } = await createService();
      const req = makeRequest({});
      await expect(service.restoreArchivedAccount(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('calls restoreByGithubUserId, establishes session, clears pendingArchived', async () => {
      const { service, usersRepo } = await createService();
      const pending = {
        githubUserId: '12345',
        login: 'testuser',
        accessToken: 'tok-restore',
      };
      const session = makeSession({ pendingArchived: pending });
      const req = { session } as unknown as Request;

      await service.restoreArchivedAccount(req);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.restoreByGithubUserId).toHaveBeenCalledWith('12345');

      const s = session as unknown as Record<string, unknown>;
      expect(s['userId']).toBe('user-1');
      expect(s['user']).toEqual(fakeUser);
      expect(s['pendingArchived']).toBeUndefined();
      expect(s['githubAccessToken']).toBe('tok-restore');
    });
  });

  describe('startFreshAccount', () => {
    it('throws UnauthorizedException when no pendingArchived in session', async () => {
      const { service } = await createService();
      const req = makeRequest({});
      await expect(service.startFreshAccount(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('hard-deletes old row, upserts new row, provisions subscription, establishes session', async () => {
      const hardDeleteSpy = jest.fn().mockResolvedValue(undefined);
      const upsertSpy = jest.fn().mockResolvedValue(fakeUser);
      const { service, usersRepo, subsRepo, exampleProjectSeederService } =
        await createService(true, undefined, {
          hardDeleteByGithubUserId: hardDeleteSpy,
          upsertGitHubUser: upsertSpy,
        });

      const pending = {
        githubUserId: '12345',
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
        accessToken: 'tok-fresh',
      };
      const session = makeSession({ pendingArchived: pending });
      const req = { session } as unknown as Request;

      await service.startFreshAccount(req);

      expect(hardDeleteSpy).toHaveBeenCalledWith('12345');
      expect(upsertSpy).toHaveBeenCalledWith({
        githubUserId: '12345',
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(subsRepo.ensureDefaultFreeSubscription).toHaveBeenCalledWith(
        'user-1',
      );
      expect(
        exampleProjectSeederService.ensureExampleProjectSeeded,
      ).toHaveBeenCalledWith('user-1');

      const s = session as unknown as Record<string, unknown>;
      expect(s['userId']).toBe('user-1');
      expect(s['pendingArchived']).toBeUndefined();
      expect(s['githubAccessToken']).toBe('tok-fresh');

      // deleteById must NOT have been called — only hardDeleteByGithubUserId.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(usersRepo.deleteById).not.toHaveBeenCalled();
    });
  });
});
