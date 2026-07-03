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
    /**
     * Login of the internal company GitHub org. When set, members of this org
     * are stamped is_internal=true on sign-in (and bypass the subscription
     * gate); non-members are hard-blocked on the internal deployment. Leave
     * empty on the external (sold) deployment to disable internal gating.
     */
    internalOrg: string;
    /**
     * ALL repositories created by the product are forced into this GitHub
     * organization instead of the signed-in user's personal account. Always
     * resolves to a non-empty org (defaults to Alpha-Explora); an empty or
     * unset GITHUB_ENFORCED_ORG falls back to the default rather than
     * re-enabling personal-account creation. Requires the GitHub App to be
     * installed on this org with access to all repositories.
     */
    enforcedOrg: string;
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
    /**
     * Deployment ownership mode offered by this deployment:
     *  - 'byo': users connect their own Render/Vercel accounts (external/sold
     *    product).
     *  - 'flowci_managed': deployments are centralized on the organization's
     *    Render/Vercel via the flowciManaged.* credentials (internal
     *    Alphaexplora deployment). BYO is not offered.
     */
    ownershipMode: 'byo' | 'flowci_managed';
    encryptionKey: string;
    flowciManaged: {
      renderToken: string;
      renderOwnerId: string | null;
      renderDefaultRegion?: string;
      renderDefaultInstanceType?: string;
      renderAllowedInstanceTypes?: string[];
      renderAllowPaidManaged?: boolean;
      renderManagedMaxServicesPerUser?: number;
      // Platform-wide caps on managed targets across ALL users. Because managed
      // mode shares a single Render/Vercel account, per-user quotas alone cannot
      // protect the shared account from aggregate exhaustion. 0 = unlimited.
      renderManagedFleetMax?: number;
      vercelManagedFleetMax?: number;
      renderBootstrapImage?: string;
      renderRegistryCredentialId?: string | null;
      renderRegistryUsername?: string | null;
      renderRegistryToken?: string | null;
      vercelToken: string;
      vercelTeamId: string | null;
      vercelTeamSlug: string | null;
    };
  };
  projectSyncSnapshots: {
    enabled: boolean;
    liveGithubEnabled: boolean;
    liveProvidersEnabled: boolean;
  };
  workflowSettingsPreview: {
    enabled: boolean;
  };
  workflowUpdatePr: {
    enabled: boolean;
  };
  projectTargetManagement: {
    enabled: boolean;
  };
  ciRunTracking: {
    enabled: boolean;
    liveGithubEnabled: boolean;
  };
  deploymentHistory: {
    enabled: boolean;
    liveProvidersEnabled: boolean;
  };
  driftDetection: {
    enabled: boolean;
  };
  driftRepair: {
    enabled: boolean;
    liveRepairEnabled: boolean;
  };
  driftLiveChecks: {
    enabled: boolean;
  };
  usageQuotas: {
    enabled: boolean;
  };
  workspaces: {
    enabled: boolean;
  };
  auditEvents: {
    enabled: boolean;
  };
  notifications: {
    enabled: boolean;
  };
  supabase: {
    dbUrl: string | undefined;
    dbCaCert?: string;
  };
  session: {
    secret: string;
    name: string;
    maxAgeMs: number;
    secure: boolean;
    storeDriver: 'postgres' | 'memory';
    // Optional cookie Domain attribute. Leave UNSET for the current split-domain
    // setup (host-only cookie, today's behavior). When FE + BE move under one
    // parent domain (e.g. app.example.com + api.example.com), set this to
    // ".example.com" so the session cookie is shared first-party across the
    // subdomains — this is what makes login work on Safari/iOS (no third-party
    // cookie). See docs/AUTH_CUSTOM_DOMAIN_CUTOVER.md.
    cookieDomain?: string;
  };
  archivedAccountRetentionDays: number;
}

export const appConfig = registerAs('app', (): AppConfig => {
  const env = process.env;
  const isProduction = env['NODE_ENV'] === 'production';

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
      // read:org is required so the OAuth token can query the signed-in user's
      // org membership (GET /user/memberships/orgs/{org}) for internal gating.
      scope: env['GITHUB_SCOPE'] ?? 'repo,workflow,read:org',
      appId: env['GITHUB_APP_ID'] ?? '',
      appSlug:
        env['GITHUB_APP_SLUG']?.trim() || (isProduction ? '' : 'my-github-app'),
      appPrivateKey: (env['GITHUB_APP_PRIVATE_KEY'] ?? '').replace(
        /\\n/g,
        '\n',
      ),
      appWebhookSecret: env['GITHUB_APP_WEBHOOK_SECRET'] ?? '',
      internalOrg: env['GITHUB_INTERNAL_ORG']?.trim() ?? '',
      // Force every created repository into this org. Defaults to Alpha-Explora
      // and, by using `||`, treats an empty or unset GITHUB_ENFORCED_ORG as the
      // default too — the product can never provision into personal accounts.
      enforcedOrg: env['GITHUB_ENFORCED_ORG']?.trim() || 'Alpha-Explora',
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
      ownershipMode:
        env['ENV_PROVISIONING_OWNERSHIP_MODE']?.trim() === 'flowci_managed'
          ? 'flowci_managed'
          : 'byo',
      encryptionKey: env['ENV_PROVISIONING_ENCRYPTION_KEY'] ?? '',
      flowciManaged: {
        renderToken: env['FLOWCI_RENDER_API_KEY'] ?? '',
        renderOwnerId: env['FLOWCI_RENDER_OWNER_ID']?.trim() || null,
        renderDefaultRegion:
          env['FLOWCI_RENDER_DEFAULT_REGION']?.trim() || 'singapore',
        renderDefaultInstanceType:
          env['FLOWCI_RENDER_DEFAULT_INSTANCE_TYPE']?.trim() || 'free',
        renderAllowedInstanceTypes: (
          env['FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES'] ?? 'free'
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        renderAllowPaidManaged:
          env['FLOWCI_RENDER_ALLOW_PAID_MANAGED'] === 'true',
        renderManagedMaxServicesPerUser: Number(
          env['FLOWCI_RENDER_MANAGED_MAX_SERVICES_PER_USER'] ?? '2',
        ),
        renderManagedFleetMax: Number(
          env['FLOWCI_RENDER_MANAGED_FLEET_MAX'] ?? '0',
        ),
        vercelManagedFleetMax: Number(
          env['FLOWCI_VERCEL_MANAGED_FLEET_MAX'] ?? '0',
        ),
        renderBootstrapImage:
          env['FLOWCI_RENDER_BOOTSTRAP_IMAGE']?.trim() ||
          'docker.io/library/nginx:alpine',
        renderRegistryCredentialId:
          env['FLOWCI_RENDER_REGISTRY_CREDENTIAL_ID']?.trim() || null,
        renderRegistryUsername:
          env['FLOWCI_RENDER_REGISTRY_USERNAME']?.trim() || null,
        renderRegistryToken:
          env['FLOWCI_RENDER_REGISTRY_TOKEN']?.trim() || null,
        vercelToken: env['FLOWCI_VERCEL_TOKEN'] ?? '',
        vercelTeamId: env['FLOWCI_VERCEL_TEAM_ID'] ?? null,
        vercelTeamSlug: env['FLOWCI_VERCEL_TEAM_SLUG'] ?? null,
      },
    },
    projectSyncSnapshots: {
      enabled: env['PROJECT_SYNC_SNAPSHOTS_ENABLED'] === 'true',
      liveGithubEnabled: env['PROJECT_SYNC_LIVE_GITHUB_ENABLED'] === 'true',
      liveProvidersEnabled:
        env['PROJECT_SYNC_LIVE_PROVIDERS_ENABLED'] === 'true',
    },
    workflowSettingsPreview: {
      enabled: env['WORKFLOW_SETTINGS_PREVIEW_ENABLED'] === 'true',
    },
    workflowUpdatePr: {
      enabled: env['WORKFLOW_UPDATE_PR_ENABLED'] === 'true',
    },
    projectTargetManagement: {
      enabled: env['PROJECT_TARGET_MANAGEMENT_ENABLED'] === 'true',
    },
    ciRunTracking: {
      enabled: env['CI_RUN_TRACKING_ENABLED'] === 'true',
      liveGithubEnabled: env['CI_RUN_LIVE_GITHUB_ENABLED'] === 'true',
    },
    deploymentHistory: {
      enabled: env['DEPLOYMENT_HISTORY_ENABLED'] === 'true',
      liveProvidersEnabled:
        env['DEPLOYMENT_HISTORY_LIVE_PROVIDERS_ENABLED'] === 'true',
    },
    driftDetection: {
      enabled: env['DRIFT_DETECTION_ENABLED'] === 'true',
    },
    driftRepair: {
      enabled: env['DRIFT_REPAIR_ENABLED'] === 'true',
      liveRepairEnabled: env['DRIFT_LIVE_REPAIR_ENABLED'] === 'true',
    },
    driftLiveChecks: {
      enabled: env['DRIFT_LIVE_PROVIDER_CHECKS_ENABLED'] === 'true',
    },
    usageQuotas: {
      enabled: env['USAGE_QUOTAS_ENABLED'] === 'true',
    },
    workspaces: {
      enabled: env['WORKSPACES_ENABLED'] === 'true',
    },
    auditEvents: {
      enabled: env['AUDIT_EVENTS_ENABLED'] === 'true',
    },
    notifications: {
      enabled: env['NOTIFICATIONS_ENABLED'] === 'true',
    },
    supabase: {
      // Trim defensively. Every sibling secret is trimmed; this one was not,
      // so a trailing newline/space pasted into a host's env panel survived
      // into the connection string and could corrupt the parsed dbname or
      // password — surfacing as a confusing "password authentication failed"
      // in one environment but not another with a visually-identical value.
      dbUrl: env['SUPABASE_DB_URL']?.trim(),
      ...(env['SUPABASE_DB_CA_CERT']?.trim()
        ? { dbCaCert: env['SUPABASE_DB_CA_CERT'].trim() }
        : {}),
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
      // Only include cookieDomain when explicitly set, so the default stays
      // host-only (current behavior) under exactOptionalPropertyTypes.
      ...(env['SESSION_COOKIE_DOMAIN']?.trim()
        ? { cookieDomain: env['SESSION_COOKIE_DOMAIN'].trim() }
        : {}),
    },
    archivedAccountRetentionDays: Number(
      env['ARCHIVED_ACCOUNT_RETENTION_DAYS'] ?? 30,
    ),
  };
});
