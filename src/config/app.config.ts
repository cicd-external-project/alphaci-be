import { registerAs } from '@nestjs/config';

import type { SubscriptionPlan } from '../common/interfaces/session-user.interface';

export interface AppConfig {
  frontendUrl: string;
  github: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    scope: string;
    appId: string;
    appPrivateKey: string;
    appWebhookSecret: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    scope: string;
  };
  templates: {
    repoPath: string;
    workflowDir: string;
  };
  subscription: {
    mockEnabled: boolean;
    defaultPlan: SubscriptionPlan;
    seededPlans: Record<string, SubscriptionPlan>;
    proMonthlyPricePhp: number;
    enterpriseMonthlyPricePhp: number;
  };
  supabase: {
    dbUrl: string | undefined;
  };
  session: {
    secret: string;
    name: string;
    maxAgeMs: number;
    secure: boolean;
    storeDriver: 'postgres' | 'memory';
  };
}

export const appConfig = registerAs('app', (): AppConfig => {
  const env = process.env;

  const seededPlans: Record<string, SubscriptionPlan> = {};
  try {
    const raw = env['SUBSCRIPTION_MOCK_MAP_JSON'] ?? '{}';
    Object.assign(
      seededPlans,
      JSON.parse(raw) as Record<string, SubscriptionPlan>,
    );
  } catch {
    // malformed JSON — fall through with empty map
  }

  return {
    frontendUrl: env['FRONTEND_URL'] ?? 'http://localhost:3000',
    github: {
      clientId: env['GITHUB_CLIENT_ID'] ?? '',
      clientSecret: env['GITHUB_CLIENT_SECRET'] ?? '',
      callbackUrl:
        env['GITHUB_CALLBACK_URL'] ??
        'http://localhost:4000/api/v1/auth/github/callback',
      scope: env['GITHUB_SCOPE'] ?? 'read:user user:email',
      appId: env['GITHUB_APP_ID'] ?? '',
      appPrivateKey: (env['GITHUB_APP_PRIVATE_KEY'] ?? '').replace(
        /\\n/g,
        '\n',
      ),
      appWebhookSecret: env['GITHUB_APP_WEBHOOK_SECRET'] ?? '',
    },
    google: {
      clientId: env['GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: env['GOOGLE_CLIENT_SECRET'] ?? '',
      callbackUrl:
        env['GOOGLE_CALLBACK_URL'] ??
        'http://localhost:4000/api/v1/auth/google/callback',
      scope: env['GOOGLE_SCOPE'] ?? 'openid email profile',
    },
    templates: {
      repoPath: env['TEMPLATE_REPO_PATH'] ?? '../cicd-workflow',
      workflowDir: env['TEMPLATE_WORKFLOW_DIR'] ?? 'workflow-templates',
    },
    subscription: {
      mockEnabled: env['SUBSCRIPTION_MOCK_ENABLED'] === 'true',
      defaultPlan:
        (env['SUBSCRIPTION_MOCK_DEFAULT_PLAN'] as
          | SubscriptionPlan
          | undefined) ?? 'free',
      seededPlans,
      proMonthlyPricePhp: Number(env['PRO_MONTHLY_PRICE_PHP'] ?? 300),
      enterpriseMonthlyPricePhp: Number(
        env['ENTERPRISE_MONTHLY_PRICE_PHP'] ?? 1200,
      ),
    },
    supabase: {
      dbUrl: env['SUPABASE_DB_URL'],
    },
    session: {
      secret: (() => {
        const raw = env['SESSION_SECRET'];
        if (!raw || raw.trim().length < 32) {
          throw new Error(
            '[config] SESSION_SECRET must be set and at least 32 characters long. ' +
              'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
          );
        }
        return raw.trim();
      })(),
      name: env['SESSION_NAME'] ?? 'cicd_workflow_sid',
      maxAgeMs: Number(env['SESSION_MAX_AGE_MS'] ?? 604_800_000),
      secure: env['SESSION_SECURE'] === 'true',
      storeDriver:
        env['SESSION_STORE_DRIVER'] === 'postgres' ? 'postgres' : 'memory',
    },
  };
});
