import { IsIn } from 'class-validator';

export class CreateCheckoutDto {
  @IsIn(['pro', 'enterprise'])
  plan: 'pro' | 'enterprise' = 'pro';
}
