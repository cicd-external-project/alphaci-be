import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { EmailCodeDeliveryService } from './email-code-delivery.service.js';
import { IdentityService } from './identity.service.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import { EmailVerificationCodesRepository } from '../persistence/email-verification-codes.repository.js';
import { OAuthStateRepository } from '../persistence/oauth-state.repository.js';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository.js';
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
  status: 'active',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeConfig = (withGitHub = true) =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'ALLOWED_ORIGINS') {
        return 'http://localhost:3000,https://cicd-workflow-hioomva9i-api-center-t.vercel.app';
      }
      if (key === 'ALLOWED_ORIGIN_PATTERNS') {
        return 'https://cicd-workflow-[^.]+\\.vercel\\.app';
      }
      return undefined;
    }),
    getOrThrow: jest.fn().mockReturnValue({
      frontendUrl: 'http://localhost:3000',
      archivedAccountRetentionDays: 30,
      google: {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        callbackUrl: 'http://localhost:4000/api/v1/auth/google/callback',
      },
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
    createFederatedUser: jest.fn().mockResolvedValue(fakeUser),
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
const makeUserIdentitiesRepo = (
  overrides?: Partial<UserIdentitiesRepository>,
) =>
  ({
    findByProviderIdentity: jest.fn().mockResolvedValue(null),
    findActiveUserIdsByVerifiedEmail: jest.fn().mockResolvedValue([]),
    upsertIdentity: jest.fn().mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      provider: 'github',
      providerUserId: '12345',
      emailVerified: true,
      archivedAt: null,
    }),
    ...overrides,
  }) as unknown as UserIdentitiesRepository;
const makeEmailCodesRepo = (
  overrides?: Partial<EmailVerificationCodesRepository>,
) =>
  ({
    create: jest.fn().mockResolvedValue('code-1'),
    findLatestActive: jest.fn().mockResolvedValue({
      id: 'code-1',
      normalizedEmail: 'test@example.com',
      codeHash: 'hash-123456',
      purpose: 'signup',
      attemptCount: 0,
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    }),
    incrementAttempt: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as EmailVerificationCodesRepository;

const makePasswordHasher = (overrides?: Partial<PasswordHasherService>) =>
  ({
    hash: jest.fn((secret: string) => Promise.resolve(`hash-${secret}`)),
    verify: jest.fn((secret: string, hash: string) =>
      Promise.resolve(hash === `hash-${secret}`),
    ),
    ...overrides,
  }) as unknown as PasswordHasherService;

const makeEmailCodeDeliveryService = (
  overrides?: Partial<EmailCodeDeliveryService>,
) =>
  ({
    sendCode: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as EmailCodeDeliveryService;

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
  const userIdentitiesRepo = makeUserIdentitiesRepo();
  const emailCodesRepo = makeEmailCodesRepo();
  const passwordHasher = makePasswordHasher();
  const emailCodeDeliveryService = makeEmailCodeDeliveryService();
  const exampleProjectSeederService = makeExampleProjectSeederService(
    exampleProjectSeederOverrides,
  );

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      IdentityService,
      { provide: ConfigService, useValue: makeConfig(withGitHub) },
      { provide: UsersRepository, useValue: usersRepo },
      { provide: SubscriptionsRepository, useValue: subsRepo },
      { provide: OutboxRepository, useValue: outboxRepo },
      { provide: OAuthStateRepository, useValue: oauthStateRepo },
      { provide: UserIdentitiesRepository, useValue: userIdentitiesRepo },
      {
        provide: EmailVerificationCodesRepository,
        useValue: emailCodesRepo,
      },
      { provide: PasswordHasherService, useValue: passwordHasher },
      {
        provide: EmailCodeDeliveryService,
        useValue: emailCodeDeliveryService,
      },
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
    userIdentitiesRepo,
    emailCodesRepo,
    passwordHasher,
    emailCodeDeliveryService,
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

function makeGoogleIdToken(claims: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'google-sub-1',
      email: 'test@example.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/avatar.png',
      aud: 'google-client-id',
      iss: 'https://accounts.google.com',
      ...claims,
    }),
  ).toString('base64url');

  return `header.${payload}.signature`;
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

    it('accepts absolute returnTo URLs from configured frontend origins', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      const returnTo =
        'https://cicd-workflow-hioomva9i-api-center-t.vercel.app/auth/callback?intent=login';

      await service.startGitHubAuth(req, returnTo);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        returnTo,
        'github',
      );
    });

    it('accepts returnTo URLs matching ALLOWED_ORIGIN_PATTERNS (new/preview deployments)', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      // This origin is NOT in ALLOWED_ORIGINS — it only matches the regex
      // pattern. Before the fix this fell back to FRONTEND_URL (the stale
      // deployment); it must now be preserved so the user returns to the
      // frontend they actually logged in from.
      const returnTo =
        'https://cicd-workflow-newdeploy-ele-tribe.vercel.app/auth/callback?intent=login';

      await service.startGitHubAuth(req, returnTo);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        returnTo,
        'github',
      );
    });

    it('rejects http:// returnTo origins even if they match a pattern shape', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();
      // Plain-HTTP can never match a pattern (HTTPS-only), so this falls back.
      await service.startGitHubAuth(
        req,
        'http://cicd-workflow-spoof.vercel.app/auth/callback',
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        'http://localhost:3000', // pattern rejected http://, fell back
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

    it('returns auth=failed (not a 500) when the DB save throws', async () => {
      const { service } = await createService(true, {
        save: jest
          .fn()
          .mockRejectedValue(new Error('connection terminated unexpectedly')),
      });
      const req = makeRequest();
      const url = await service.startGitHubAuth(req);
      expect(url).toContain('auth=failed');
      expect(url).not.toContain('github.com');
    });
  });

  describe('startGoogleAuth', () => {
    it('saves google OAuth state and returns Google auth URL', async () => {
      const { service, oauthStateRepo } = await createService();
      const req = makeRequest();

      const url = await service.startGoogleAuth(req, '/signup');

      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(oauthStateRepo.save).toHaveBeenCalledWith(
        expect.any(String),
        'http://localhost:3000/signup',
        'google',
      );
    });
  });

  describe('handleGoogleCallback', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest
        .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
        .mockImplementation(jest.fn());
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('returns invalid_state when DB record has wrong provider', async () => {
      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue({
          returnTo: 'http://localhost:3000',
          provider: 'github',
        }),
      });

      const url = await service.handleGoogleCallback(
        makeRequest(),
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=invalid_state');
    });

    it('returns email_unverified for Google identities without verified email', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id_token: makeGoogleIdToken({ email_verified: false }),
          }),
      } as unknown as Response);
      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue({
          returnTo: 'http://localhost:3000',
          provider: 'google',
        }),
      });

      const url = await service.handleGoogleCallback(
        makeRequest(),
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=email_unverified');
    });

    it('establishes a session after successful Google callback', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id_token: makeGoogleIdToken() }),
      } as unknown as Response);
      const { service } = await createService(true, {
        findAndDelete: jest.fn().mockResolvedValue({
          returnTo: 'http://localhost:3000',
          provider: 'google',
        }),
      });
      const req = makeRequest();

      const url = await service.handleGoogleCallback(
        req,
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=success');
      expect(
        (req.session as unknown as Record<string, unknown>)['userId'],
      ).toBe('user-1');
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
      // Regression guard: an expired/unknown state must land on the callback
      // page (which renders the error), not the marketing homepage root.
      expect(url).toContain('/auth/callback');
    });

    it('returns auth=failed (not a 500) when the state DB lookup throws', async () => {
      // Regression: a transient DB connection error during findAndDelete used to
      // propagate out of the callback as an unhandled 500 because the lookup sat
      // outside the try/catch. It must now degrade to an auth=failed redirect.
      const { service } = await createService(true, {
        findAndDelete: jest
          .fn()
          .mockRejectedValue(new Error('connection terminated unexpectedly')),
      });
      const req = makeRequest();
      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );
      expect(url).toContain('auth=failed');
      expect(url).toContain('/auth/callback');
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

    it('keeps current GitHub login working through identity resolver', async () => {
      mockSuccessfulGitHubFetch(fetchMock);
      const { service } = await createService();
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=success');
      expect(
        (req.session as unknown as Record<string, unknown>)['userId'],
      ).toBe('user-1');
    });

    it('returns email_required for a new GitHub identity without verified email', async () => {
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
          json: () => Promise.resolve([]),
        } as unknown as Response);

      const { service } = await createService();
      const req = makeRequest();

      const url = await service.handleGitHubCallback(
        req,
        'code123',
        'valid-state',
      );

      expect(url).toContain('auth=email_required');
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

  describe('email password auth', () => {
    it('starts email signup without establishing a session', async () => {
      const {
        service,
        userIdentitiesRepo,
        emailCodesRepo,
        emailCodeDeliveryService,
      } = await createService();

      const result = await service.startEmailSignup({
        firstName: 'Test',
        lastName: 'User',
        email: 'TEST@example.com ',
        password: 'password123',
      });

      expect(result).toEqual({ ok: true, verificationRequired: true });
      expect(userIdentitiesRepo.upsertIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'email',
          providerUserId: 'test@example.com',
          emailVerified: false,
          passwordHash: 'hash-password123',
        }),
      );
      expect(emailCodesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          normalizedEmail: 'test@example.com',
          purpose: 'signup',
        }),
      );
      expect(emailCodeDeliveryService.sendCode).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          purpose: 'signup',
        }),
      );
    });

    it('verifies signup code and establishes a session', async () => {
      const {
        service,
        userIdentitiesRepo,
        subsRepo,
        exampleProjectSeederService,
      } = await createService();
      (
        userIdentitiesRepo.findByProviderIdentity as jest.Mock
      ).mockResolvedValue({
        id: 'identity-1',
        userId: 'user-1',
        provider: 'email',
        providerUserId: 'test@example.com',
        email: 'test@example.com',
        emailVerified: false,
        passwordHash: 'hash-password123',
        archivedAt: null,
      });
      const req = makeRequest();

      const result = await service.verifyEmailSignupCode(req, {
        email: 'test@example.com',
        code: '123456',
      });

      expect(result).toMatchObject({ ok: true, authenticated: true });
      expect(
        (req.session as unknown as Record<string, unknown>)['userId'],
      ).toBe('user-1');
      expect(subsRepo.ensureDefaultFreeSubscription).toHaveBeenCalledWith(
        'user-1',
      );
      expect(
        exampleProjectSeederService.ensureExampleProjectSeeded,
      ).toHaveBeenCalledWith('user-1');
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
