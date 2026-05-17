export class TribeClient {
  authenticate = jest.fn().mockResolvedValue(undefined);
  gauthGetAuthorizationUrl = jest.fn().mockResolvedValue({
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1',
  });
  gauthExchangeCode = jest.fn();
  paymentCreateCheckoutSession = jest.fn();
  paymentGetCheckoutSession = jest.fn();
}

export interface PaymentCheckoutSession {
  checkoutId?: string;
  id?: string;
  status: string;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
}
