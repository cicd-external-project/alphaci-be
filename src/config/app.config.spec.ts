import { appConfig } from './app.config.js';

describe('appConfig factory', () => {
  const originalEnv = process.env;
  const validSessionSecret = 'a'.repeat(32);

  beforeEach(() => {
    process.env = { ...originalEnv, SESSION_SECRET: validSessionSecret };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when only the required session secret is set', () => {
    delete process.env['FRONTEND_URL'];
    delete process.env['GITHUB_CLIENT_ID'];
    delete process.env['SUBSCRIPTION_MOCK_ENABLED'];
    delete process.env['SESSION_STORE_DRIVER'];

    const config = appConfig();

    expect(config.frontendUrl).toBe('http://localhost:3000');
    expect(config.github.clientId).toBe('');
    expect(config.session.secret).toBe(validSessionSecret);
    expect(config.subscription.mockEnabled).toBe(false);
    expect(config.session.storeDriver).toBe('memory');
  });

  it('reads environment variables when set', () => {
    process.env['FRONTEND_URL'] = 'https://app.example.com';
    process.env['GITHUB_CLIENT_ID'] = 'gh-id';
    process.env['SUBSCRIPTION_MOCK_ENABLED'] = 'true';
    process.env['SESSION_STORE_DRIVER'] = 'postgres';
    process.env['SESSION_SECURE'] = 'true';

    const config = appConfig();

    expect(config.frontendUrl).toBe('https://app.example.com');
    expect(config.github.clientId).toBe('gh-id');
    expect(config.subscription.mockEnabled).toBe(true);
    expect(config.session.storeDriver).toBe('postgres');
    expect(config.session.secure).toBe(true);
  });

  it('parses SUBSCRIPTION_MOCK_MAP_JSON correctly', () => {
    process.env['SUBSCRIPTION_MOCK_MAP_JSON'] = JSON.stringify({ testuser: 'pro' });

    const config = appConfig();
    expect(config.subscription.seededPlans).toEqual({ testuser: 'pro' });
  });

  it('falls back to empty seededPlans on malformed JSON', () => {
    process.env['SUBSCRIPTION_MOCK_MAP_JSON'] = 'not-valid-json';

    const config = appConfig();
    expect(config.subscription.seededPlans).toEqual({});
  });

  it('normalizes GITHUB_APP_PRIVATE_KEY newline escapes', () => {
    process.env['GITHUB_APP_PRIVATE_KEY'] = 'line1\\nline2';

    const config = appConfig();
    expect(config.github.appPrivateKey).toBe('line1\nline2');
  });

  it('uses storeDriver memory when SESSION_STORE_DRIVER is not postgres', () => {
    process.env['SESSION_STORE_DRIVER'] = 'redis';

    const config = appConfig();
    expect(config.session.storeDriver).toBe('memory');
  });
});
