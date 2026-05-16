import { Injectable, Logger } from '@nestjs/common';
import { TribeClient } from '@implementsprint/sdk';
import type {
  KafkaGovernedPublishResponse,
  GoogleOAuthTokenResponse,
  PaymentCheckoutSession,
} from '@implementsprint/sdk';

@Injectable()
export class ApiCenterClientService {
  private readonly logger = new Logger(ApiCenterClientService.name);
  public readonly client: TribeClient;

  constructor() {
    this.client = new TribeClient({
      gatewayUrl:
        process.env['API_CENTER_BASE_URL'] ?? 'http://api-center-service',
      tribeId: process.env['API_CENTER_TRIBE_ID'] ?? 'local_dev',
      secret: process.env['API_CENTER_TRIBE_SECRET'] ?? 'local_secret',
    });
  }

  async sendKafkaMessage(
    topic: string,
    message: Record<string, unknown>,
    eventType: string,
  ): Promise<KafkaGovernedPublishResponse> {
    try {
      return await this.client.kafkaPublish({
        topic,
        eventType,
        payload: message,
      });
    } catch (error) {
      this.logger.error(`Failed to send Kafka message to ${topic}`, error);
      throw error;
    }
  }

  async verifyGoogleAuth(
    code: string,
    redirectUri: string,
  ): Promise<GoogleOAuthTokenResponse> {
    try {
      return await this.client.gauthExchangeCode({ code, redirectUri });
    } catch (error) {
      this.logger.error('Failed to verify Google Auth', error);
      throw error;
    }
  }

  async createPayMongoCheckout(
    referenceId: string,
    lineItems: Array<{ name: string; quantity: number; amountPhp: number }>,
    successUrl: string,
    cancelUrl: string,
  ): Promise<PaymentCheckoutSession> {
    try {
      return await this.client.paymentCreateCheckoutSession({
        referenceId,
        successUrl,
        cancelUrl,
        lineItems: lineItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          amount: { value: item.amountPhp, currency: 'PHP' },
        })),
      });
    } catch (error) {
      this.logger.error('Failed to create PayMongo checkout session', error);
      throw error;
    }
  }
}
