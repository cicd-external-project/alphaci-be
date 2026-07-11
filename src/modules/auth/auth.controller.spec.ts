import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminsRepository } from '../admin/platform-admins.repository.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import type { Request, Response } from 'express';
import type {
  SessionUser,
  SubscriptionState,
} from '../../common/interfaces/session-user.interface.js';

const fakeUser: SessionUser = {
  id: 'user-1',
  login: 'testuser',
  onboardingCompleted: false,
};

const fakeFreeSub: SubscriptionState = {
  plan: 'free',
  status: 'inactive',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeRequest = (
  user?: SessionUser,
  sessionExtra: Record<string, unknown> = {},
) =>
  ({
    session: {
      user,
      ...sessionExtra,
      save: jest.fn().mockImplementation((cb: (err: null) => void) => cb(null)),
      destroy: jest
        .fn()
        .mockImplementation((cb: (err: null) => void) => cb(null)),
    },
  }) as unknown as Request;

const makeResponse = () => {
  const res = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
    clearCookie: jest.fn(),
  };
  return res as unknown as Response;
};

const makeAuthService = () =>
  ({
    startGitHubAuth: jest
      .fn()
      .mockReturnValue('https://github.com/login/oauth/authorize?mock=1'),
    handleGitHubCallback: jest
      .fn()
      .mockResolvedValue('http://localhost:3000?auth=success'),
    startGoogleAuth: jest
      .fn()
      .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
    handleGoogleCallback: jest
      .fn()
      .mockResolvedValue('http://localhost:3000?auth=success'),
    getSessionUser: jest.fn().mockResolvedValue(fakeUser),
    listConnectedIdentities: jest.fn().mockResolvedValue({
      methods: [
        { provider: 'github', email: 'tone@example.test', emailVerified: true },
      ],
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    getPendingArchivedAccount: jest.fn().mockResolvedValue({ pending: false }),
    restoreArchivedAccount: jest.fn().mockResolvedValue(undefined),
    startFreshAccount: jest.fn().mockResolvedValue(undefined),
    checkEmailSignupAvailability: jest.fn().mockResolvedValue({
      ok: true,
      available: true,
    }),

    startEmailSignup: jest.fn().mockResolvedValue({
      ok: true,
      verificationRequired: true,
    }),
    verifyEmailSignupCode: jest.fn().mockResolvedValue({
      ok: true,
      authenticated: true,
      user: fakeUser,
    }),
    loginWithEmail: jest.fn().mockResolvedValue({
      ok: true,
      authenticated: true,
      user: fakeUser,
    }),
    resendEmailSignupCode: jest.fn().mockResolvedValue({
      ok: true,
      verificationRequired: true,
    }),
  }) as unknown as AuthService;

const makeSubscriptionService = () =>
  ({
    getForUser: jest.fn().mockResolvedValue(fakeFreeSub),
  }) as unknown as SubscriptionService;

const makeConfigService = () =>
  ({
    getOrThrow: jest
      .fn()
      .mockReturnValue({ session: { name: 'cicd_workflow_sid' } }),
  }) as unknown as ConfigService;

const makePlatformAdminsRepository = () =>
  ({
    findRole: jest.fn().mockResolvedValue(null),
  }) as unknown as PlatformAdminsRepository;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let subscriptionService: SubscriptionService;

  beforeEach(async () => {
    authService = makeAuthService();
    subscriptionService = makeSubscriptionService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SubscriptionService, useValue: subscriptionService },
        {
          provide: PlatformAdminsRepository,
          useValue: makePlatformAdminsRepository(),
        },
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('email auth endpoints', () => {
    it('checks email signup availability', async () => {
      const result = await controller.checkEmailSignup({
        email: 'tone@example.test',
      });

      expect(result).toEqual({ ok: true, available: true });
      expect(authService.checkEmailSignupAvailability).toHaveBeenCalledWith(
        'tone@example.test',
      );
    });
    it('starts email signup', async () => {
      const body = {
        firstName: 'Tone',
        lastName: 'User',
        email: 'tone@example.test',
        password: 'password123',
      };

      const result = await controller.emailSignup(body);

      expect(result).toEqual({ ok: true, verificationRequired: true });
      expect(authService.startEmailSignup).toHaveBeenCalledWith(body);
    });

    it('verifies an email code', async () => {
      const req = makeRequest();
      const body = { email: 'tone@example.test', code: '123456' };

      const result = await controller.verifyEmailCode(req, body);

      expect(result).toMatchObject({ ok: true, authenticated: true });
      expect(authService.verifyEmailSignupCode).toHaveBeenCalledWith(req, body);
    });

    it('logs in with email and password', async () => {
      const req = makeRequest();
      const body = { email: 'tone@example.test', password: 'password123' };

      const result = await controller.emailLogin(req, body);

      expect(result).toMatchObject({ ok: true, authenticated: true });
      expect(authService.loginWithEmail).toHaveBeenCalledWith(req, body);
    });

    it('resends an email code', async () => {
      const result = await controller.resendEmailCode({
        email: 'tone@example.test',
      });

      expect(result).toEqual({ ok: true, verificationRequired: true });
      expect(authService.resendEmailSignupCode).toHaveBeenCalledWith(
        'tone@example.test',
      );
    });
  });
  describe('googleStart', () => {
    it('redirects to Google auth URL', async () => {
      const req = makeRequest();
      const res = makeResponse();

      await controller.googleStart(req, res, '/signup');

      expect(authService.startGoogleAuth).toHaveBeenCalledWith(req, '/signup');
      expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      expect(res.redirect).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?mock=1',
      );
    });
  });

  describe('googleCallback', () => {
    it('redirects to callback result URL', async () => {
      const req = makeRequest();
      const res = makeResponse();

      await controller.googleCallback(req, res, 'code123', 'state123');

      expect(authService.handleGoogleCallback).toHaveBeenCalledWith(
        req,
        'code123',
        'state123',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000?auth=success',
      );
    });
  });
  describe('githubStart', () => {
    it('redirects to GitHub auth URL', async () => {
      const req = makeRequest();
      const res = makeResponse();
      await controller.githubStart(req, res);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      expect(res.redirect).toHaveBeenCalledWith(
        'https://github.com/login/oauth/authorize?mock=1',
      );
    });
  });

  describe('githubCallback', () => {
    it('redirects to success URL after callback', async () => {
      const req = makeRequest();
      const res = makeResponse();
      await controller.githubCallback(req, res, 'code123', 'state-abc');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authService.handleGitHubCallback).toHaveBeenCalledWith(
        req,
        'code123',
        'state-abc',
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000?auth=success',
      );
    });
  });

  describe('identities', () => {
    it('returns connected sign-in methods', async () => {
      const req = makeRequest(fakeUser);
      const result = await controller.identities(req);

      expect(result).toEqual({
        methods: [
          {
            provider: 'github',
            email: 'tone@example.test',
            emailVerified: true,
          },
        ],
      });
      expect(authService.listConnectedIdentities).toHaveBeenCalledWith(req);
    });
  });
  describe('me', () => {
    it('returns authenticated user with subscription', async () => {
      const req = makeRequest(fakeUser);
      const result = await controller.me(req);
      expect(result).toMatchObject({
        authenticated: true,
        user: fakeUser,
        githubConnected: true,
        subscription: fakeFreeSub,
      });
      expect(authService.listConnectedIdentities).toHaveBeenCalledWith(req);
    });

    it('returns unauthenticated when no user', async () => {
      (authService.getSessionUser as jest.Mock).mockResolvedValueOnce(null);
      const req = makeRequest();
      const result = await controller.me(req);
      expect(result).toEqual({ authenticated: false });
    });
  });

  describe('logout', () => {
    it('calls logout and clears cookie', async () => {
      const req = makeRequest(fakeUser);
      const res = makeResponse();
      const result = await controller.logout(req, res);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authService.logout).toHaveBeenCalledWith(req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(res.clearCookie).toHaveBeenCalledWith('cicd_workflow_sid');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('deleteAccount', () => {
    it('calls archiveById via deleteAccount and returns { ok, archived }', async () => {
      const req = makeRequest(fakeUser);
      const res = makeResponse();
      const result = await controller.deleteAccount(req, res);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authService.deleteAccount).toHaveBeenCalledWith(req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(res.clearCookie).toHaveBeenCalledWith('cicd_workflow_sid');
      expect(result).toEqual({ ok: true, archived: true });
    });

    it('throws UnauthorizedException when no user in session', async () => {
      const req = makeRequest();
      const res = makeResponse();
      await expect(controller.deleteAccount(req, res)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getPendingArchivedAccount', () => {
    it('returns { pending: false } when service returns pending false', async () => {
      const req = makeRequest();
      const result = await controller.getPendingArchivedAccount(req);
      expect(result).toEqual({ pending: false });
    });

    it('returns pending info when service returns pending true', async () => {
      const pendingInfo = {
        pending: true as const,
        login: 'testuser',
        archivedAt: '2026-05-01T00:00:00.000Z',
        purgeAt: '2026-05-31T00:00:00.000Z',
        retentionDays: 30,
      };
      (
        authService.getPendingArchivedAccount as jest.Mock
      ).mockResolvedValueOnce(pendingInfo);
      const req = makeRequest();
      const result = await controller.getPendingArchivedAccount(req);
      expect(result).toEqual(pendingInfo);
    });
  });

  describe('restoreArchivedAccount', () => {
    it('returns { ok, restored } when pendingArchived is in session', async () => {
      const req = makeRequest(undefined, {
        pendingArchived: {
          githubUserId: '12345',
          login: 'testuser',
          accessToken: 'tok',
        },
      });
      const result = await controller.restoreArchivedAccount(req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authService.restoreArchivedAccount).toHaveBeenCalledWith(req);
      expect(result).toEqual({ ok: true, restored: true });
    });

    it('throws UnauthorizedException when no pendingArchived in session', async () => {
      const req = makeRequest(undefined, {});
      await expect(controller.restoreArchivedAccount(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('startFreshAccount', () => {
    it('returns { ok, created } when pendingArchived is in session', async () => {
      const req = makeRequest(undefined, {
        pendingArchived: {
          githubUserId: '12345',
          login: 'testuser',
          accessToken: 'tok',
        },
      });
      const result = await controller.startFreshAccount(req);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(authService.startFreshAccount).toHaveBeenCalledWith(req);
      expect(result).toEqual({ ok: true, created: true });
    });

    it('throws UnauthorizedException when no pendingArchived in session', async () => {
      const req = makeRequest(undefined, {});
      await expect(controller.startFreshAccount(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
