import { IsIn, IsOptional } from 'class-validator';

export type HostedCheckoutPaymentMethod =
  | 'card'
  | 'ewallets'
  | 'gcash'
  | 'maya'
  | 'paymaya'
  | 'qrph';

export class CreateCheckoutDto {
  @IsIn(['pro'])
  plan = 'pro' as const;

  @IsOptional()
  @IsIn(['card', 'ewallets', 'gcash', 'maya', 'paymaya', 'qrph'])
  paymentMethod?: HostedCheckoutPaymentMethod;
}
