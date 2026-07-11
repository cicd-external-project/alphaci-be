import { ConfigService } from '@nestjs/config';

import { EmailCodeDeliveryService } from './email-code-delivery.service.js';
import { EmailCodeTemplateService } from './email-code-template.service.js';

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

const baseConfig = (overrides: Record<string, string | undefined> = {}) =>
  makeConfig({
    NODE_ENV: 'development',
    AUTH_EMAIL_CODE_DELIVERY: 'log',
    ...overrides,
  });

describe('EmailCodeDeliveryService', () => {
  it('logs rendered codes in development log mode', async () => {
    const service = new EmailCodeDeliveryService(
      baseConfig(),
      new EmailCodeTemplateService(),
    );
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await service.sendCode({
      email: 'tone@example.test',
      code: '123456',
      purpose: 'signup',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('tone@example.test'),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Verify your email address'),
    );
    spy.mockRestore();
  });

  it('sends rendered codes through Resend in provider mode', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new EmailCodeDeliveryService(
      baseConfig({
        AUTH_EMAIL_CODE_DELIVERY: 'provider',
        AUTH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
        AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
      }),
      new EmailCodeTemplateService(),
      fetchFn,
    );

    await service.sendCode({
      email: 'tone@example.test',
      code: '123456',
      purpose: 'signup',
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
        },
      }),
    );
    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      from: 'AlphaCI <no-reply@example.test>',
      to: ['tone@example.test'],
      subject: 'Verify your email address',
      html: expect.stringContaining('123456'),
      text: expect.stringContaining('123456'),
    });
  });

  it('throws in production when no real provider is configured', async () => {
    const service = new EmailCodeDeliveryService(
      baseConfig({ NODE_ENV: 'production' }),
      new EmailCodeTemplateService(),
    );

    await expect(
      service.sendCode({
        email: 'tone@example.test',
        code: '123456',
        purpose: 'signup',
      }),
    ).rejects.toThrow('Production email code delivery is not configured');
  });

  it('throws when Resend provider config is incomplete', async () => {
    const service = new EmailCodeDeliveryService(
      baseConfig({
        AUTH_EMAIL_CODE_DELIVERY: 'provider',
        AUTH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
      }),
      new EmailCodeTemplateService(),
      jest.fn(),
    );

    await expect(
      service.sendCode({
        email: 'tone@example.test',
        code: '123456',
        purpose: 'signup',
      }),
    ).rejects.toThrow('Resend email delivery is not configured');
  });

  it('surfaces top-level Resend API error messages', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'The sender domain is not verified',
          name: 'validation_error',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new EmailCodeDeliveryService(
      baseConfig({
        AUTH_EMAIL_CODE_DELIVERY: 'provider',
        AUTH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
        AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
      }),
      new EmailCodeTemplateService(),
      fetchFn,
    );

    await expect(
      service.sendCode({
        email: 'tone@example.test',
        code: '123456',
        purpose: 'signup',
      }),
    ).rejects.toThrow(
      'Resend email delivery failed: HTTP 403: The sender domain is not verified',
    );
  });

  it('includes HTTP status when Resend returns an empty error body', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 401 }));
    const service = new EmailCodeDeliveryService(
      baseConfig({
        AUTH_EMAIL_CODE_DELIVERY: 'provider',
        AUTH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
        AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
      }),
      new EmailCodeTemplateService(),
      fetchFn,
    );

    await expect(
      service.sendCode({
        email: 'tone@example.test',
        code: '123456',
        purpose: 'signup',
      }),
    ).rejects.toThrow('Resend email delivery failed: HTTP 401');
  });

  it('surfaces Resend API failures', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Domain is not verified',
            name: 'validation_error',
          },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new EmailCodeDeliveryService(
      baseConfig({
        AUTH_EMAIL_CODE_DELIVERY: 'provider',
        AUTH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
        AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
      }),
      new EmailCodeTemplateService(),
      fetchFn,
    );

    await expect(
      service.sendCode({
        email: 'tone@example.test',
        code: '123456',
        purpose: 'signup',
      }),
    ).rejects.toThrow(
      'Resend email delivery failed: HTTP 422: Domain is not verified',
    );
  });
});
