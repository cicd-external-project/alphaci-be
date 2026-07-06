import { ConfigService } from '@nestjs/config';

import { EmailCodeDeliveryService } from './email-code-delivery.service.js';
import { EmailCodeTemplateService } from './email-code-template.service.js';

const makeConfig = (mode: string, nodeEnv = 'development') =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'NODE_ENV') return nodeEnv;
      if (key === 'AUTH_EMAIL_CODE_DELIVERY') return mode;
      return undefined;
    }),
  }) as unknown as ConfigService;

describe('EmailCodeDeliveryService', () => {
  it('logs rendered codes in development log mode', async () => {
    const service = new EmailCodeDeliveryService(
      makeConfig('log'),
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

  it('throws in production when no real provider is configured', async () => {
    const service = new EmailCodeDeliveryService(
      makeConfig('log', 'production'),
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
});
