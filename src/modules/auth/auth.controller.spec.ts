import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { SessionUser, SubscriptionState } from '../../common/interfaces/session-user.interface.js';

const fakeUser: SessionUser = { id: 'user-1', login: 'testuser' };

const fakeFreeSub: SubscriptionState = {
  plan: 'free',
  status: 'inactive',
  provider: 'supabase',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeRequest = (user?: SessionUser) =>
  ({ session: { user } }) as unknown as Request;

const makeResponse = () => {
  const res = {
    redirect: jest.fn(),
    clearCookie: jest.fn(),
  };
  return res as unknown as Response;
};

const makeAuthService = () =>
  ({
    startGitHubAuth: jest.fn().mockReturnValue('https://github.com/login/oauth/authorize?mock=1'),
    handleGitHubCallback: jest.fn().mockResolvedValue('http://localhost:3000?auth=success'),
    getSessionUser: jest.fn().mockResolvedValue(fakeUser),
    logout: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuthService;

const makeSubscriptionService = () =>
  ({
    getForUser: jest.fn().mockResolvedValue(fakeFreeSub),
  }) as unknown as SubscriptionService;

const makeConfigService = () =>
  ({
    getOrThrow: jest.fn().mockReturnValue({ session: { name: 'cicd_workflow_sid' } }),
  }) as unknown as ConfigService;

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
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    })
      .overrideGuard(require('../../common/guards/session-auth.guard.js').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('githubStart', () => {
    it('redirects to GitHub auth URL', async () => {
      const req = makeRequest();
      const res = makeResponse();
      await controller.githubStart(req, res);
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
      expect(authService.handleGitHubCallback).toHaveBeenCalledWith(
        req,
        'code123',
        'state-abc',
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000?auth=success');
    });
  });

  describe('me', () => {
    it('returns authenticated user with subscription', async () => {
      const req = makeRequest(fakeUser);
      const result = await controller.me(req);
      expect(result).toMatchObject({
        authenticated: true,
        user: fakeUser,
        subscription: fakeFreeSub,
      });
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
      expect(authService.logout).toHaveBeenCalledWith(req);
      expect(res.clearCookie).toHaveBeenCalledWith('cicd_workflow_sid');
      expect(result).toEqual({ ok: true });
    });
  });
});
