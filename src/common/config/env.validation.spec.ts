import { validateEnv } from './env.validation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    SESSION_SECRET: 'a'.repeat(32),
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:3000',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateEnv', () => {
  describe('happy path', () => {
    it('returns a fully typed config object for a valid env', () => {
      const result = validateEnv(validEnv());

      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
      expect(result.SUPABASE_URL).toBe('https://abc.supabase.co');
      expect(result.SUPABASE_ANON_KEY).toBe('anon-key');
      expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key');
      expect(result.ALLOWED_ORIGINS).toBe('http://localhost:5173');
    });

    it('accepts production as NODE_ENV', () => {
      const result = validateEnv(validEnv({ NODE_ENV: 'production' }));
      expect(result.NODE_ENV).toBe('production');
    });

    it('accepts test as NODE_ENV', () => {
      const result = validateEnv(validEnv({ NODE_ENV: 'test' }));
      expect(result.NODE_ENV).toBe('test');
    });

    it('accepts scoped Supabase-only config without default SUPABASE_* trio', () => {
      const result = validateEnv(
        validEnv({
          SUPABASE_URL: undefined,
          SUPABASE_ANON_KEY: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
          PAYMENT_SERVICE_SUPABASE_URL: 'https://payment.supabase.co',
          PAYMENT_SERVICE_SUPABASE_SECRET_KEY: 'payment-secret',
        }),
      );

      expect(result.SUPABASE_URL).toBeUndefined();
      expect(result.SUPABASE_ANON_KEY).toBeUndefined();
      expect(result.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    });

    it('accepts incomplete default SUPABASE_* when scoped clients are configured', () => {
      const result = validateEnv(
        validEnv({
          SUPABASE_ANON_KEY: undefined,
          PAYMENT_SERVICE_SUPABASE_URL: 'https://payment.supabase.co',
          PAYMENT_SERVICE_SUPABASE_SECRET_KEY: 'payment-secret',
        }),
      );

      expect(result.SUPABASE_URL).toBe('https://abc.supabase.co');
      expect(result.SUPABASE_ANON_KEY).toBeUndefined();
      expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key');
    });

    it('defaults ENABLE_SWAGGER to "false" when not set', () => {
      const result = validateEnv(validEnv());
      expect(result.ENABLE_SWAGGER).toBe('false');
    });

    it('uses the provided ENABLE_SWAGGER value when set', () => {
      const result = validateEnv(validEnv({ ENABLE_SWAGGER: 'true' }));
      expect(result.ENABLE_SWAGGER).toBe('true');
    });

    it('accepts disabled Supabase DB TLS verification outside production', () => {
      const result = validateEnv(
        validEnv({ SUPABASE_DB_SSL_REJECT_UNAUTHORIZED: 'false' }),
      );

      expect(result.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED).toBe('false');
    });

    it('trims leading/trailing whitespace from string values', () => {
      const result = validateEnv(
        validEnv({ SUPABASE_URL: '  https://abc.supabase.co  ' }),
      );
      expect(result.SUPABASE_URL).toBe('https://abc.supabase.co');
    });
  });

  describe('NODE_ENV validation', () => {
    it('throws for an invalid NODE_ENV value', () => {
      expect(() => validateEnv(validEnv({ NODE_ENV: 'staging' }))).toThrow(
        /NODE_ENV/,
      );
    });

    it('throws when NODE_ENV is missing', () => {
      const env = validEnv();
      delete env['NODE_ENV'];
      expect(() => validateEnv(env)).toThrow(/NODE_ENV/);
    });

    it('throws when NODE_ENV is an empty string', () => {
      expect(() => validateEnv(validEnv({ NODE_ENV: '' }))).toThrow(/NODE_ENV/);
    });
  });

  describe('email delivery validation', () => {
    it('accepts Resend config when provider delivery is enabled', () => {
      const result = validateEnv(
        validEnv({
          AUTH_EMAIL_CODE_DELIVERY: 'provider',
          AUTH_EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_test_key',
          AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
        }),
      );

      expect(result.AUTH_EMAIL_PROVIDER).toBe('resend');
      expect(result.RESEND_API_KEY).toBe('re_test_key');
      expect(result.AUTH_EMAIL_FROM).toBe('AlphaCI <no-reply@example.test>');
    });

    it('throws when provider delivery has an unsupported email provider', () => {
      expect(() =>
        validateEnv(
          validEnv({
            AUTH_EMAIL_CODE_DELIVERY: 'provider',
            AUTH_EMAIL_PROVIDER: 'smtp',
            RESEND_API_KEY: 're_test_key',
            AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
          }),
        ),
      ).toThrow(/AUTH_EMAIL_PROVIDER/);
    });

    it('throws when provider delivery is missing a Resend API key', () => {
      expect(() =>
        validateEnv(
          validEnv({
            AUTH_EMAIL_CODE_DELIVERY: 'provider',
            AUTH_EMAIL_PROVIDER: 'resend',
            AUTH_EMAIL_FROM: 'AlphaCI <no-reply@example.test>',
          }),
        ),
      ).toThrow(/RESEND_API_KEY/);
    });

    it('throws when provider delivery is missing a from address', () => {
      expect(() =>
        validateEnv(
          validEnv({
            AUTH_EMAIL_CODE_DELIVERY: 'provider',
            AUTH_EMAIL_PROVIDER: 'resend',
            RESEND_API_KEY: 're_test_key',
          }),
        ),
      ).toThrow(/AUTH_EMAIL_FROM/);
    });
  });

  describe('Supabase DB TLS validation', () => {
    it('throws for an invalid SUPABASE_DB_SSL_REJECT_UNAUTHORIZED value', () => {
      expect(() =>
        validateEnv(validEnv({ SUPABASE_DB_SSL_REJECT_UNAUTHORIZED: 'nope' })),
      ).toThrow(/SUPABASE_DB_SSL_REJECT_UNAUTHORIZED/);
    });

    it('throws when Supabase DB TLS verification is disabled in production', () => {
      expect(() =>
        validateEnv(
          validEnv({
            NODE_ENV: 'production',
            SUPABASE_DB_SSL_REJECT_UNAUTHORIZED: 'false',
          }),
        ),
      ).toThrow(/SUPABASE_DB_SSL_REJECT_UNAUTHORIZED/);
    });
  });

  describe('production auth cookie validation', () => {
    it('throws for split frontend/backend domains without a shared cookie domain', () => {
      expect(() =>
        validateEnv(
          validEnv({
            NODE_ENV: 'production',
            SESSION_SECURE: 'true',
            FRONTEND_URL: 'https://alphaci.vercel.app',
            GITHUB_CALLBACK_URL:
              'https://alphaci-api.onrender.com/api/v1/auth/github/callback',
          }),
        ),
      ).toThrow(/SESSION_COOKIE_DOMAIN/);
    });

    it('accepts split frontend/backend subdomains when SESSION_COOKIE_DOMAIN is set', () => {
      const result = validateEnv(
        validEnv({
          NODE_ENV: 'production',
          SESSION_SECURE: 'true',
          FRONTEND_URL: 'https://app.example.com',
          GITHUB_CALLBACK_URL:
            'https://api.example.com/api/v1/auth/github/callback',
          SESSION_COOKIE_DOMAIN: '.example.com',
        }),
      );

      expect(result.SESSION_COOKIE_DOMAIN).toBe('.example.com');
    });
  });
  describe('PORT validation', () => {
    it('defaults PORT to 4000 when missing', () => {
      const env = validEnv();
      delete env['PORT'];
      expect(validateEnv(env).PORT).toBe(4000);
    });

    it('throws when PORT is zero', () => {
      expect(() => validateEnv(validEnv({ PORT: '0' }))).toThrow(/PORT/);
    });

    it('throws when PORT is above 65535', () => {
      expect(() => validateEnv(validEnv({ PORT: '65536' }))).toThrow(/PORT/);
    });

    it('throws when PORT is not a number', () => {
      expect(() => validateEnv(validEnv({ PORT: 'abc' }))).toThrow(/PORT/);
    });

    it('accepts PORT at boundary value 1', () => {
      const result = validateEnv(validEnv({ PORT: '1' }));
      expect(result.PORT).toBe(1);
    });

    it('accepts PORT at boundary value 65535', () => {
      const result = validateEnv(validEnv({ PORT: '65535' }));
      expect(result.PORT).toBe(65535);
    });
  });

  describe('required string fields', () => {
    const requiredFields = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ALLOWED_ORIGINS',
      'FRONTEND_URL',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
    ];

    for (const field of requiredFields) {
      it(`throws when ${field} is missing`, () => {
        const env = validEnv();
        delete env[field];
        expect(() => validateEnv(env)).toThrow(new RegExp(field));
      });

      it(`throws when ${field} is an empty string`, () => {
        expect(() => validateEnv(validEnv({ [field]: '' }))).toThrow(
          new RegExp(field),
        );
      });

      it(`throws when ${field} is whitespace only`, () => {
        expect(() => validateEnv(validEnv({ [field]: '   ' }))).toThrow(
          new RegExp(field),
        );
      });
    }
  });
});
