import {
  Body,
  Controller,
  Get,
  Headers,
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
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async getSubscription(@Req() req: Request) {
    const user = this.getUser(req);

    return {
      subscription: await this.subscriptionService.getForUser(user),
    };
  }

  @Post('checkout')
  @UseGuards(SessionAuthGuard)
  async createCheckout(@Req() req: Request, @Body() body: CreateCheckoutDto) {
    const user = this.getUser(req);
    return this.subscriptionService.createCheckoutSession(user, body.plan);
  }

  @Get('checkout/:checkoutId/status')
  @UseGuards(SessionAuthGuard)
  async getCheckoutStatus(
    @Req() req: Request,
    @Param('checkoutId') checkoutId: string,
  ) {
    const user = this.getUser(req);
    return this.subscriptionService.getCheckoutStatus(user, checkoutId);
  }

  @Post('monthly/activate')
  @UseGuards(SessionAuthGuard)
  async activateMonthly(
    @Req() req: Request,
    @Body() body: ActivateSubscriptionDto,
  ) {
    return this.activateInternal(req, body);
  }

  @Post('monthly/cancel')
  @UseGuards(SessionAuthGuard)
  async cancelMonthly(@Req() req: Request) {
    return this.cancelInternal(req);
  }

  @Post('webhooks/paymongo')
  async handlePayMongoWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('paymongo-signature') signature?: string,
  ) {
    return this.subscriptionService.handlePayMongoWebhook(body, req.rawBody, signature);
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
