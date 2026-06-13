import {
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
import { AuthService } from './auth.service';

@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('auth')
export class AuthController {
  private readonly sessionCookieName: string;

  constructor(
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
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

  /** GET /auth/config-check — non-sensitive config diagnostic (no secrets exposed) */
  @SkipThrottle()
  @UseGuards(DevOnlyGuard)
  @Get('config-check')
  configCheck() {
    const cfg = this.configService.getOrThrow<AppConfig>('app');
    return {
      githubScope:        cfg.github.scope        || '(empty)',
      githubAppSlug:      cfg.github.appSlug       || '(empty)',
      githubClientId:     cfg.github.clientId ? `${cfg.github.clientId.slice(0, 6)}…` : '(not set)',
      callbackUrl:        cfg.github.callbackUrl   || '(empty)',
      frontendUrl:        cfg.frontendUrl          || '(empty)',
      sessionDriver:      cfg.session.storeDriver,
      sessionSecure:      cfg.session.secure,
      supabaseDbUrl:      cfg.supabase.dbUrl ? 'set' : '(not set)',
      mockEnabled:        cfg.subscription.mockEnabled,
      defaultPlan:        cfg.subscription.defaultPlan,
    };
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

    return {
      authenticated: true,
      user,
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

    return { ok: true };
  }
}
