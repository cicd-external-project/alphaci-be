import { Injectable, Logger } from '@nestjs/common';
import { TribeClient } from '@implementsprint/sdk';

@Injectable()
export class ApiCenterClientService {
  private readonly logger = new Logger(ApiCenterClientService.name);
  public readonly client: TribeClient;

  constructor() {
    // Initialize the official SDK from api-shared
    this.client = new TribeClient({
      baseUrl: process.env.API_CENTER_BASE_URL || 'http://api-center-service',
      tribeId: process.env.API_CENTER_TRIBE_ID || 'local_dev',
      tribeSecret: process.env.API_CENTER_TRIBE_SECRET || 'local_secret',
    });
  }

  async sendKafkaMessage(topic: string, message: any, referenceId?: string) {
    try {
      const response = await this.client.kafkaPublish({
        topic,
        payload: message,
        referenceId: referenceId || `ref-${Date.now()}`
      });
      return response;
    } catch (error) {
      this.logger.error(`Failed to send Kafka message to ${topic}`, error);
      throw error;
    }
  }

  async verifyGoogleAuth(code: string, redirectUri: string) {
    try {
      const response = await this.client.gauthExchangeCode({ code, redirectUri });
      return response;
    } catch (error) {
      this.logger.error(`Failed to verify Google Auth`, error);
      throw error;
    }
  }

  async createPayMongoIntent(amount: number, description: string) {
    try {
      const response = await this.client.paymentCreateCheckoutSession({
        amount,
        currency: 'PHP',
        description,
        cancelUrl: 'http://localhost:3000/cancel',
        successUrl: 'http://localhost:3000/success'
      });
      return response;
    } catch (error) {
      this.logger.error(`Failed to create PayMongo intent`, error);
      throw error;
    }
  }
}