import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { AppConfig } from '../../config/app.config';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { PlatformAdminsRepository } from '../admin/platform-admins.repository';
import { AuthService } from './auth.service';
import {
  EmailAvailabilityDto,
  EmailLoginDto,
  EmailSignupDto,
  ResendEmailCodeDto,
  VerifyEmailCodeDto,
} from './dto/email-auth.dto';

@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('auth')
export class AuthController {
  private readonly sessionCookieName: string;

  constructor(
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
    private readonly platformAdminsRepository: PlatformAdminsRepository,
    private readonly configService: ConfigService,
  ) {
    this.sessionCookieName =
      this.configService.getOrThrow<AppConfig>('app').session.name;
  }

  @Get('github/start')
  async githubStart(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    // Keep the popup opener alive while the browser crosses to GitHub and back.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    const redirectUrl = await this.authService.startGitHubAuth(req, returnTo);
    return res.redirect(redirectUrl);
  }

  @SkipThrottle()
  @Get('github/callback')
  async githubCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const redirectUrl = await this.authService.handleGitHubCallback(
      req,
      code,
      state,
    );
    return res.redirect(redirectUrl);
  }
  @Post('email/check')
  async checkEmailSignup(@Body() body: EmailAvailabilityDto) {
    return this.authService.checkEmailSignupAvailability(body.email);
  }
  @Post('email/signup')
  async emailSignup(@Body() body: EmailSignupDto) {
    return this.authService.startEmailSignup(body);
  }

  @Post('email/verify-code')
  async verifyEmailCode(@Req() req: Request, @Body() body: VerifyEmailCodeDto) {
    return this.authService.verifyEmailSignupCode(req, body);
  }

  @Post('email/login')
  async emailLogin(@Req() req: Request, @Body() body: EmailLoginDto) {
    return this.authService.loginWithEmail(req, body);
  }

  @Post('email/resend-code')
  async resendEmailCode(@Body() body: ResendEmailCodeDto) {
    return this.authService.resendEmailSignupCode(body.email);
  }

  @Get('google/start')
  async googleStart(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    // Apply the same popup policy to Google OAuth for consistent provider behavior.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    const redirectUrl = await this.authService.startGoogleAuth(req, returnTo);
    return res.redirect(redirectUrl);
  }

  @SkipThrottle()
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const redirectUrl = await this.authService.handleGoogleCallback(
      req,
      code,
      state,
    );
    return res.redirect(redirectUrl);
  }

  @SkipThrottle()
  @UseGuards(DevOnlyGuard)
  @Get('config-check')
  configCheck() {
    const cfg = this.configService.getOrThrow<AppConfig>('app');
    return {
      githubScope: cfg.github.scope || '(empty)',
      githubAppSlug: cfg.github.appSlug || '(empty)',
      githubClientId: cfg.github.clientId
        ? `${cfg.github.clientId.slice(0, 6)}…`
        : '(not set)',
      callbackUrl: cfg.github.callbackUrl || '(empty)',
      frontendUrl: cfg.frontendUrl || '(empty)',
      sessionDriver: cfg.session.storeDriver,
      sessionSecure: cfg.session.secure,
      supabaseDbUrl: cfg.supabase.dbUrl ? 'set' : '(not set)',
      mockEnabled: cfg.subscription.mockEnabled,
      defaultPlan: cfg.subscription.defaultPlan,
    };
  }

  @UseGuards(SessionAuthGuard)
  @Get('identities')
  async identities(@Req() req: Request) {
    return this.authService.listConnectedIdentities(req);
  }

  @SkipThrottle()
  @UseGuards(SessionAuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.authService.getSessionUser(req);
    if (!user) {
      return {
        authenticated: false,
      };
    }

    const identities = await this.authService.listConnectedIdentities(req);

    return {
      authenticated: true,
      user,
      githubConnected: identities.methods.some(
        (identity) => identity.provider === 'github',
      ),
      // null for ordinary users; 'admin' | 'super_admin' for platform admins.
      // The frontend uses this to gate the /admin surface.
      platformRole: await this.platformAdminsRepository.findRole(user.id),
      subscription: await Promise.resolve(
        this.subscriptionService.getForUser(user),
      ),
    };
  }

  @UseGuards(SessionAuthGuard)
  @Post('onboarding/complete')
  async completeOnboarding(@Req() req: Request) {
    await this.authService.completeOnboarding(req);
    return { ok: true, onboardingCompleted: true };
  }

  @UseGuards(SessionAuthGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req);
    res.clearCookie(this.sessionCookieName);

    return {
      ok: true,
    };
  }

  /**
   * DELETE /auth/account
   *
   * Soft-deletes (archives) the authenticated user's account. All data is
   * preserved but the account becomes inaccessible until a restore is
   * explicitly requested. Returns { ok: true, archived: true }.
   */
  @UseGuards(SessionAuthGuard)
  @Delete('account')
  async deleteAccount(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    await this.authService.deleteAccount(req);
    res.clearCookie(this.sessionCookieName);

    return { ok: true, archived: true };
  }

  /**
   * GET /auth/account/pending
   *
   * Returns information about the archived account whose GitHub login was
   * used in the most recent OAuth callback that resulted in archived_choice.
   * The user is NOT authenticated (no SessionAuthGuard). Safe because the
   * pendingArchived payload was set by a real OAuth callback, not by the
   * client.
   */
  @SkipThrottle()
  @Get('account/pending')
  async getPendingArchivedAccount(@Req() req: Request) {
    return this.authService.getPendingArchivedAccount(req);
  }

  /**
   * POST /auth/account/restore
   *
   * Restores the archived account identified by req.session.pendingArchived
   * and establishes a full authenticated session. The user is NOT authenticated
   * prior to calling this — their identity is validated via pendingArchived
   * which was set by a real OAuth callback.
   *
   * Returns { ok: true, restored: true }.
   */
  @Post('account/restore')
  async restoreArchivedAccount(@Req() req: Request) {
    if (!req.session.pendingArchived) {
      throw new UnauthorizedException(
        'No pending archived account in this session',
      );
    }

    await this.authService.restoreArchivedAccount(req);
    return { ok: true, restored: true };
  }

  /**
   * POST /auth/account/start-fresh
   *
   * Hard-deletes the archived account identified by req.session.pendingArchived
   * (cascading to all child rows) and inserts a brand-new active account.
   * A default free subscription is provisioned and a full session is
   * established. The user is NOT authenticated prior to calling this.
   *
   * Returns { ok: true, created: true }.
   */
  @Post('account/start-fresh')
  async startFreshAccount(@Req() req: Request) {
    if (!req.session.pendingArchived) {
      throw new UnauthorizedException(
        'No pending archived account in this session',
      );
    }

    await this.authService.startFreshAccount(req);
    return { ok: true, created: true };
  }
}
