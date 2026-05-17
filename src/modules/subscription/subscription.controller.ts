import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import type { SessionUser } from '../../common/interfaces/session-user.interface';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
@UseGuards(SessionAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  async getSubscription(@Req() req: Request) {
    const user = this.getUser(req);

    return {
      subscription: await this.subscriptionService.getForUser(user),
    };
  }

  @Post('checkout')
  async createCheckout(@Req() req: Request, @Body() body: CreateCheckoutDto) {
    const user = this.getUser(req);
    return this.subscriptionService.createCheckoutSession(user, body.plan);
  }

  @Get('checkout/:checkoutId/status')
  async getCheckoutStatus(
    @Req() req: Request,
    @Param('checkoutId') checkoutId: string,
  ) {
    const user = this.getUser(req);
    return this.subscriptionService.getCheckoutStatus(user, checkoutId);
  }

  @Post('monthly/activate')
  async activateMonthly(
    @Req() req: Request,
    @Body() body: ActivateSubscriptionDto,
  ) {
    return this.activateInternal(req, body);
  }

  @Post('monthly/cancel')
  async cancelMonthly(@Req() req: Request) {
    return this.cancelInternal(req);
  }

  private async activateInternal(req: Request, body: ActivateSubscriptionDto) {
    const user = this.getUser(req);

    return {
      subscription: await this.subscriptionService.activateForUser(
        user,
        body.plan ?? 'pro',
      ),
    };
  }

  private async cancelInternal(req: Request) {
    const user = this.getUser(req);

    return {
      subscription: await this.subscriptionService.cancelForUser(user),
    };
  }

  private getUser(req: Request): SessionUser {
    const user = req.session?.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }
}
