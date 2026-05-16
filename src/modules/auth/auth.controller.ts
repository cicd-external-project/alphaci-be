import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('github/start')
  githubStart(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    const redirectUrl = this.authService.startGitHubAuth(req, returnTo);
    return res.redirect(redirectUrl);
  }

  @Get('google/start')
  googleStart(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    const redirectUrl = this.authService.startGoogleAuth(req, returnTo);
    return res.redirect(redirectUrl);
  }

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
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req);
    res.clearCookie('cicd_workflow_sid');

    return {
      ok: true,
    };
  }
}
