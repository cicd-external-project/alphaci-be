import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailCodeTemplateService } from './email-code-template.service';
import type { VerificationCodePurpose } from '../persistence/email-verification-codes.repository';

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

    await Promise.resolve();

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

    throw new Error('Production email code delivery is not configured');
  }
}
