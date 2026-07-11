import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailCodeTemplateService } from './email-code-template.service';
import type { VerificationCodePurpose } from '../persistence/email-verification-codes.repository';

const RESEND_EMAIL_API_URL = 'https://api.resend.com/emails';
const EMAIL_DELIVERY_FETCH = Symbol('EMAIL_DELIVERY_FETCH');

type FetchLike = typeof fetch;

interface ResendErrorResponse {
  message?: string;
  name?: string;
  error?: {
    message?: string;
    name?: string;
  };
}

export interface SendEmailCodeInput {
  email: string;
  code: string;
  purpose: VerificationCodePurpose;
}

@Injectable()
export class EmailCodeDeliveryService {
  constructor(
    private readonly configService: ConfigService,
    private readonly templateService: EmailCodeTemplateService,
    @Optional()
    @Inject(EMAIL_DELIVERY_FETCH)
    private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  async sendCode(input: SendEmailCodeInput): Promise<void> {
    const mode =
      this.configService.get<string>('AUTH_EMAIL_CODE_DELIVERY') ?? 'log';
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    const rendered = this.templateService.renderVerificationCodeEmail({
      email: input.email,
      code: input.code,
      expiresInMinutes: 10,
    });

    if (mode === 'log' && nodeEnv !== 'production') {
      console.info(
        [
          `[auth-email-code] ${input.purpose} code for ${input.email}: ${input.code}`,
          `subject: ${rendered.subject}`,
          rendered.text,
        ].join('\n'),
      );
      return;
    }

    if (mode === 'provider') {
      await this.sendWithResend({
        to: input.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return;
    }

    throw new Error('Production email code delivery is not configured');
  }

  private async sendWithResend(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const provider = this.configService.get<string>('AUTH_EMAIL_PROVIDER');
    const apiKey = this.configService.get<string>('RESEND_API_KEY')?.trim();
    const from = this.configService.get<string>('AUTH_EMAIL_FROM')?.trim();

    if (provider !== 'resend' || !apiKey || !from) {
      throw new Error('Resend email delivery is not configured');
    }

    const response = await this.fetchFn(RESEND_EMAIL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const message = await this.readResendErrorMessage(response);
      throw new Error(`Resend email delivery failed: ${message}`);
    }
  }

  private async readResendErrorMessage(response: Response): Promise<string> {
    const status = `HTTP ${response.status}`;
    const statusText = response.statusText.trim();

    try {
      const body = (await response.json()) as ResendErrorResponse;
      const message = body.error?.message?.trim() || body.message?.trim();
      return message
        ? `${status}: ${message}`
        : [status, statusText].filter(Boolean).join(' ');
    } catch {
      return [status, statusText].filter(Boolean).join(' ');
    }
  }
}
