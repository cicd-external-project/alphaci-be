import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { DomainsService, type ReserveCustomDomainInput, type ReserveManagedDomainInput, type VerifyDomainInput } from './domains.service';

@Controller('runtime-domains')
@UseGuards(SessionAuthGuard, SubscriptionGuard)
export class DomainsController {
  constructor(private readonly service: DomainsService) {}

  @Post('managed')
  reserveManaged(@Body() body: ReserveManagedDomainInput) {
    return this.service.reserveManagedDomain(body);
  }

  @Post('custom')
  reserveCustom(@Body() body: ReserveCustomDomainInput) {
    return this.service.reserveCustomDomain(body);
  }

  @Post('verify')
  verify(@Body() body: VerifyDomainInput) {
    return this.service.verifyDomain(body);
  }
}
