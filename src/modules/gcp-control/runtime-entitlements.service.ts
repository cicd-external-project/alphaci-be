import { Injectable } from '@nestjs/common';

export type RuntimePlanTier = 'trial' | 'lower_shared' | 'production_business';
export type RuntimeSubscriptionStatus =
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'downgrade_grace'
  | 'past_due'
  | 'canceled_at_period_end'
  | 'canceled';
export type RuntimePlacement = 'shared' | 'dedicated';

export interface RuntimeEntitlementInput {
  planTier: RuntimePlanTier;
  subscriptionStatus: RuntimeSubscriptionStatus;
  projectCount: number;
  previewCount: number;
  customDomainCount: number;
  runtimePlacement: RuntimePlacement;
  dedicatedProjectGatesReady?: boolean;
}

export interface RuntimeEntitlementDecision {
  canDeploy: boolean;
  canCreatePreview: boolean;
  canAttachCustomDomain: boolean;
  canCreateDedicatedProject: boolean;
  previewLimit: number;
  customDomainLimit: number;
  maxInstances: number;
  deploysPerHour: number;
  projectVisible: boolean;
  retainEnvVars: boolean;
  retainExistingCustomDomains: boolean;
  retainExistingDedicatedRuntime: boolean;
  customerDatabaseManagedByAlphaCI: false;
  cleanupDestructive: false;
  limitReasons: string[];
}

const PLAN_LIMITS: Record<
  RuntimePlanTier,
  Pick<
    RuntimeEntitlementDecision,
    'previewLimit' | 'customDomainLimit' | 'maxInstances' | 'deploysPerHour'
  >
> = {
  trial: {
    previewLimit: 0,
    customDomainLimit: 0,
    maxInstances: 1,
    deploysPerHour: 2,
  },
  lower_shared: {
    previewLimit: 1,
    customDomainLimit: 0,
    maxInstances: 2,
    deploysPerHour: 6,
  },
  production_business: {
    previewLimit: 5,
    customDomainLimit: 5,
    maxInstances: 5,
    deploysPerHour: 20,
  },
};

@Injectable()
export class RuntimeEntitlementsService {
  evaluate(input: RuntimeEntitlementInput): RuntimeEntitlementDecision {
    const limits = PLAN_LIMITS[input.planTier];
    const reasons: string[] = [];
    const statusBlocksDeploy = new Set<RuntimeSubscriptionStatus>([
      'trial_expired',
      'past_due',
      'canceled',
    ]);

    if (input.subscriptionStatus === 'trial_expired') {
      reasons.push('TRIAL_EXPIRED');
    }
    if (input.subscriptionStatus === 'past_due') {
      reasons.push('PAYMENT_PAST_DUE');
    }
    if (input.subscriptionStatus === 'canceled') {
      reasons.push('SUBSCRIPTION_CANCELED');
    }
    if (limits.previewLimit === 0) {
      reasons.push('PREVIEWS_REQUIRE_PAID_PLAN');
    }
    if (input.previewCount >= limits.previewLimit && limits.previewLimit > 0) {
      reasons.push('PREVIEW_LIMIT_REACHED');
    }
    if (limits.customDomainLimit === 0) {
      reasons.push('CUSTOM_DOMAINS_REQUIRE_PRODUCTION_BUSINESS');
    }
    if (
      input.customDomainCount >= limits.customDomainLimit &&
      limits.customDomainLimit > 0
    ) {
      reasons.push('CUSTOM_DOMAIN_LIMIT_REACHED');
    }
    if (
      input.planTier === 'production_business' &&
      input.dedicatedProjectGatesReady !== true
    ) {
      reasons.push('DEDICATED_PROJECT_GATES_NOT_READY');
    }

    const blockedByStatus = statusBlocksDeploy.has(input.subscriptionStatus);
    const downgradeGrace = input.subscriptionStatus === 'downgrade_grace';

    return {
      canDeploy: !blockedByStatus,
      canCreatePreview:
        !blockedByStatus &&
        !downgradeGrace &&
        limits.previewLimit > 0 &&
        input.previewCount < limits.previewLimit,
      canAttachCustomDomain:
        !blockedByStatus &&
        !downgradeGrace &&
        limits.customDomainLimit > 0 &&
        input.customDomainCount < limits.customDomainLimit,
      canCreateDedicatedProject:
        !blockedByStatus &&
        !downgradeGrace &&
        input.planTier === 'production_business' &&
        input.dedicatedProjectGatesReady === true,
      previewLimit: limits.previewLimit,
      customDomainLimit: limits.customDomainLimit,
      maxInstances: limits.maxInstances,
      deploysPerHour: limits.deploysPerHour,
      projectVisible: true,
      retainEnvVars: true,
      retainExistingCustomDomains:
        downgradeGrace || input.subscriptionStatus === 'canceled_at_period_end',
      retainExistingDedicatedRuntime:
        input.runtimePlacement === 'dedicated' &&
        (downgradeGrace ||
          input.subscriptionStatus === 'canceled_at_period_end'),
      customerDatabaseManagedByAlphaCI: false,
      cleanupDestructive: false,
      limitReasons: [...new Set(reasons)],
    };
  }
}
