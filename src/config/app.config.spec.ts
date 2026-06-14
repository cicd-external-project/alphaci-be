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
    delete process.env['PROJECT_SYNC_SNAPSHOTS_ENABLED'];
    delete process.env['PROJECT_SYNC_LIVE_GITHUB_ENABLED'];
    delete process.env['PROJECT_SYNC_LIVE_PROVIDERS_ENABLED'];
    delete process.env['WORKFLOW_SETTINGS_PREVIEW_ENABLED'];
    delete process.env['WORKFLOW_UPDATE_PR_ENABLED'];
    delete process.env['PROJECT_TARGET_MANAGEMENT_ENABLED'];
    delete process.env['CI_RUN_TRACKING_ENABLED'];
    delete process.env['CI_RUN_LIVE_GITHUB_ENABLED'];
    delete process.env['DEPLOYMENT_HISTORY_ENABLED'];
    delete process.env['DEPLOYMENT_HISTORY_LIVE_PROVIDERS_ENABLED'];
    delete process.env['DRIFT_DETECTION_ENABLED'];
    delete process.env['DRIFT_REPAIR_ENABLED'];
    delete process.env['DRIFT_LIVE_PROVIDER_CHECKS_ENABLED'];
    delete process.env['DRIFT_LIVE_REPAIR_ENABLED'];
    delete process.env['USAGE_QUOTAS_ENABLED'];
    delete process.env['WORKSPACES_ENABLED'];
    delete process.env['AUDIT_EVENTS_ENABLED'];
    delete process.env['NOTIFICATIONS_ENABLED'];
    delete process.env['SESSION_STORE_DRIVER'];

    const config = appConfig();

    expect(config.frontendUrl).toBe('http://localhost:3000');
    expect(config.github.clientId).toBe('');
    expect(config.session.secret).toBe(validSessionSecret);
    expect(config.subscription.mockEnabled).toBe(false);
    expect(config.projectSyncSnapshots.enabled).toBe(false);
    expect(config.projectSyncSnapshots.liveGithubEnabled).toBe(false);
    expect(config.projectSyncSnapshots.liveProvidersEnabled).toBe(false);
    expect(config.workflowSettingsPreview.enabled).toBe(false);
    expect(config.workflowUpdatePr.enabled).toBe(false);
    expect(config.projectTargetManagement.enabled).toBe(false);
    expect(config.ciRunTracking.enabled).toBe(false);
    expect(config.ciRunTracking.liveGithubEnabled).toBe(false);
    expect(config.deploymentHistory.enabled).toBe(false);
    expect(config.deploymentHistory.liveProvidersEnabled).toBe(false);
    expect(config.driftDetection.enabled).toBe(false);
    expect(config.driftRepair.enabled).toBe(false);
    expect(config.driftRepair.liveRepairEnabled).toBe(false);
    expect(config.driftLiveChecks.enabled).toBe(false);
    expect(config.usageQuotas.enabled).toBe(false);
    expect(config.workspaces.enabled).toBe(false);
    expect(config.auditEvents.enabled).toBe(false);
    expect(config.notifications.enabled).toBe(false);
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
    process.env['SUBSCRIPTION_MOCK_MAP_JSON'] = JSON.stringify({
      testuser: 'pro',
    });

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

  it('reads FlowCI-managed Render owner id when set', () => {
    process.env['FLOWCI_RENDER_OWNER_ID'] = 'tea-configured';

    const config = appConfig();
    expect(config.envProvisioning.flowciManaged.renderOwnerId).toBe(
      'tea-configured',
    );
  });

  it('enables project sync snapshots when explicitly flagged', () => {
    process.env['PROJECT_SYNC_SNAPSHOTS_ENABLED'] = 'true';
    process.env['PROJECT_SYNC_LIVE_GITHUB_ENABLED'] = 'true';
    process.env['PROJECT_SYNC_LIVE_PROVIDERS_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.projectSyncSnapshots.enabled).toBe(true);
    expect(config.projectSyncSnapshots.liveGithubEnabled).toBe(true);
    expect(config.projectSyncSnapshots.liveProvidersEnabled).toBe(true);
  });

  it('enables workflow settings preview when explicitly flagged', () => {
    process.env['WORKFLOW_SETTINGS_PREVIEW_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.workflowSettingsPreview.enabled).toBe(true);
  });

  it('enables workflow update PR creation when explicitly flagged', () => {
    process.env['WORKFLOW_UPDATE_PR_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.workflowUpdatePr.enabled).toBe(true);
  });

  it('enables project target management when explicitly flagged', () => {
    process.env['PROJECT_TARGET_MANAGEMENT_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.projectTargetManagement.enabled).toBe(true);
  });

  it('enables CI run tracking flags when explicitly flagged', () => {
    process.env['CI_RUN_TRACKING_ENABLED'] = 'true';
    process.env['CI_RUN_LIVE_GITHUB_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.ciRunTracking.enabled).toBe(true);
    expect(config.ciRunTracking.liveGithubEnabled).toBe(true);
  });

  it('enables deployment history flags when explicitly flagged', () => {
    process.env['DEPLOYMENT_HISTORY_ENABLED'] = 'true';
    process.env['DEPLOYMENT_HISTORY_LIVE_PROVIDERS_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.deploymentHistory.enabled).toBe(true);
    expect(config.deploymentHistory.liveProvidersEnabled).toBe(true);
  });

  it('enables drift detection when explicitly flagged', () => {
    process.env['DRIFT_DETECTION_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.driftDetection.enabled).toBe(true);
  });

  it('enables drift repair when explicitly flagged', () => {
    process.env['DRIFT_REPAIR_ENABLED'] = 'true';
    process.env['DRIFT_LIVE_REPAIR_ENABLED'] = 'true';
    process.env['DRIFT_LIVE_PROVIDER_CHECKS_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.driftRepair.enabled).toBe(true);
    expect(config.driftRepair.liveRepairEnabled).toBe(true);
    expect(config.driftLiveChecks.enabled).toBe(true);
  });

  it('enables usage quotas when explicitly flagged', () => {
    process.env['USAGE_QUOTAS_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.usageQuotas.enabled).toBe(true);
  });

  it('enables workspace audit and notification flags when explicitly flagged', () => {
    process.env['WORKSPACES_ENABLED'] = 'true';
    process.env['AUDIT_EVENTS_ENABLED'] = 'true';
    process.env['NOTIFICATIONS_ENABLED'] = 'true';

    const config = appConfig();

    expect(config.workspaces.enabled).toBe(true);
    expect(config.auditEvents.enabled).toBe(true);
    expect(config.notifications.enabled).toBe(true);
  });

  it('defaults archivedAccountRetentionDays to 30', () => {
    delete process.env['ARCHIVED_ACCOUNT_RETENTION_DAYS'];
    const config = appConfig();
    expect(config.archivedAccountRetentionDays).toBe(30);
  });

  it('reads ARCHIVED_ACCOUNT_RETENTION_DAYS from env', () => {
    process.env['ARCHIVED_ACCOUNT_RETENTION_DAYS'] = '60';
    const config = appConfig();
    expect(config.archivedAccountRetentionDays).toBe(60);
  });
});
