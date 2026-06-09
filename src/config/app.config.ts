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
    appSlug: string;
    appPrivateKey: string;
    appWebhookSecret: string;
  };
  templates: {
    repoPath: string;
    workflowDir: string;
  };
  subscription: {
    gateEnabled: boolean;
    mockEnabled: boolean;
    defaultPlan: SubscriptionPlan;
    seededPlans: Record<string, SubscriptionPlan>;
    proMonthlyPricePhp: number;
    paymentProvider: 'none' | 'paymongo';
    successUrl: string;
    cancelUrl: string;
    paymongo: {
      secretKey: string;
      webhookSecret: string;
    };
  };
  envProvisioning: {
    enabled: boolean;
    encryptionKey: string;
    flowciManaged: {
      renderToken: string;
      renderOwnerId: string | null;
      vercelToken: string;
      vercelTeamId: string | null;
      vercelTeamSlug: string | null;
    };
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
      appSlug: env['GITHUB_APP_SLUG'] ?? 'my-github-app',
      appPrivateKey: (env['GITHUB_APP_PRIVATE_KEY'] ?? '').replace(
        /\\n/g,
        '\n',
      ),
      appWebhookSecret: env['GITHUB_APP_WEBHOOK_SECRET'] ?? '',
    },
    templates: {
      repoPath: env['TEMPLATE_REPO_PATH'] ?? '../cicd-workflow',
      workflowDir: env['TEMPLATE_WORKFLOW_DIR'] ?? 'workflow-templates',
    },
    subscription: {
      gateEnabled: env['SUBSCRIPTION_GATE_ENABLED'] !== 'false',
      mockEnabled: env['SUBSCRIPTION_MOCK_ENABLED'] === 'true',
      defaultPlan:
        (env['SUBSCRIPTION_MOCK_DEFAULT_PLAN'] as
          | SubscriptionPlan
          | undefined) ?? 'free',
      seededPlans,
      proMonthlyPricePhp: Number(env['PRO_MONTHLY_PRICE_PHP'] ?? 300),
      paymentProvider:
        env['PAYMENT_PROVIDER'] === 'paymongo' ? 'paymongo' : 'none',
      successUrl:
        env['PAYMENT_SUCCESS_URL'] ??
        `${env['FRONTEND_URL'] ?? 'http://localhost:3000'}/subscribe?status=success`,
      cancelUrl:
        env['PAYMENT_CANCEL_URL'] ??
        `${env['FRONTEND_URL'] ?? 'http://localhost:3000'}/subscribe?status=cancelled`,
      paymongo: {
        secretKey: env['PAYMONGO_SECRET_KEY'] ?? '',
        webhookSecret: env['PAYMONGO_WEBHOOK_SECRET'] ?? '',
      },
    },
    envProvisioning: {
      enabled: env['ENV_PROVISIONING_ENABLED'] === 'true',
      encryptionKey: env['ENV_PROVISIONING_ENCRYPTION_KEY'] ?? '',
      flowciManaged: {
        renderToken: env['FLOWCI_RENDER_API_KEY'] ?? '',
        renderOwnerId: env['FLOWCI_RENDER_OWNER_ID']?.trim() || null,
        vercelToken: env['FLOWCI_VERCEL_TOKEN'] ?? '',
        vercelTeamId: env['FLOWCI_VERCEL_TEAM_ID'] ?? null,
        vercelTeamSlug: env['FLOWCI_VERCEL_TEAM_SLUG'] ?? null,
      },
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
              "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
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
