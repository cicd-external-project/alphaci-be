import { RuntimeEntitlementsService } from './runtime-entitlements.service';

describe('RuntimeEntitlementsService', () => {
  const service = new RuntimeEntitlementsService();

  it('allows trial shared runtime with no previews or custom domains', () => {
    const result = service.evaluate({
      planTier: 'trial',
      subscriptionStatus: 'trialing',
      projectCount: 1,
      previewCount: 0,
      customDomainCount: 0,
      runtimePlacement: 'shared',
    });

    expect(result.canDeploy).toBe(true);
    expect(result.canCreatePreview).toBe(false);
    expect(result.canAttachCustomDomain).toBe(false);
    expect(result.canCreateDedicatedProject).toBe(false);
    expect(result.previewLimit).toBe(0);
    expect(result.limitReasons).toContain('PREVIEWS_REQUIRE_PAID_PLAN');
  });

  it('blocks new deploys after trial expiration without deleting the project', () => {
    const result = service.evaluate({
      planTier: 'trial',
      subscriptionStatus: 'trial_expired',
      projectCount: 1,
      previewCount: 0,
      customDomainCount: 0,
      runtimePlacement: 'shared',
    });

    expect(result.canDeploy).toBe(false);
    expect(result.projectVisible).toBe(true);
    expect(result.cleanupDestructive).toBe(false);
    expect(result.limitReasons).toContain('TRIAL_EXPIRED');
  });

  it('allows lower shared paid deploys and one active preview but no custom domains at first', () => {
    const result = service.evaluate({
      planTier: 'lower_shared',
      subscriptionStatus: 'active',
      projectCount: 2,
      previewCount: 0,
      customDomainCount: 0,
      runtimePlacement: 'shared',
    });

    expect(result.canDeploy).toBe(true);
    expect(result.canCreatePreview).toBe(true);
    expect(result.canAttachCustomDomain).toBe(false);
    expect(result.maxInstances).toBe(2);
  });

  it('allows production business custom domains and dedicated projects only when gates are ready', () => {
    const blocked = service.evaluate({
      planTier: 'production_business',
      subscriptionStatus: 'active',
      projectCount: 3,
      previewCount: 4,
      customDomainCount: 2,
      runtimePlacement: 'shared',
      dedicatedProjectGatesReady: false,
    });

    expect(blocked.canCreateDedicatedProject).toBe(false);
    expect(blocked.limitReasons).toContain('DEDICATED_PROJECT_GATES_NOT_READY');

    const allowed = service.evaluate({
      planTier: 'production_business',
      subscriptionStatus: 'active',
      projectCount: 3,
      previewCount: 4,
      customDomainCount: 2,
      runtimePlacement: 'shared',
      dedicatedProjectGatesReady: true,
    });

    expect(allowed.canAttachCustomDomain).toBe(true);
    expect(allowed.canCreateDedicatedProject).toBe(true);
    expect(allowed.previewLimit).toBe(5);
  });

  it('puts downgrades into grace without removing custom domains or dedicated resources immediately', () => {
    const result = service.evaluate({
      planTier: 'lower_shared',
      subscriptionStatus: 'downgrade_grace',
      projectCount: 3,
      previewCount: 1,
      customDomainCount: 2,
      runtimePlacement: 'dedicated',
    });

    expect(result.canDeploy).toBe(true);
    expect(result.canCreatePreview).toBe(false);
    expect(result.canAttachCustomDomain).toBe(false);
    expect(result.retainExistingCustomDomains).toBe(true);
    expect(result.retainExistingDedicatedRuntime).toBe(true);
  });

  it('limits failed-payment accounts without deleting running runtime resources', () => {
    const result = service.evaluate({
      planTier: 'production_business',
      subscriptionStatus: 'past_due',
      projectCount: 3,
      previewCount: 1,
      customDomainCount: 1,
      runtimePlacement: 'dedicated',
    });

    expect(result.canDeploy).toBe(false);
    expect(result.canCreatePreview).toBe(false);
    expect(result.projectVisible).toBe(true);
    expect(result.cleanupDestructive).toBe(false);
    expect(result.limitReasons).toContain('PAYMENT_PAST_DUE');
  });

  it('cancellation disables new deploys at end of term but retains env vars and external databases', () => {
    const result = service.evaluate({
      planTier: 'production_business',
      subscriptionStatus: 'canceled',
      projectCount: 3,
      previewCount: 0,
      customDomainCount: 1,
      runtimePlacement: 'dedicated',
    });

    expect(result.canDeploy).toBe(false);
    expect(result.retainEnvVars).toBe(true);
    expect(result.customerDatabaseManagedByAlphaCI).toBe(false);
    expect(result.cleanupDestructive).toBe(false);
  });
});
