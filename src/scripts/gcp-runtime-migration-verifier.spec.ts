import {
  buildVerificationConfig,
  formatVerificationPlan,
  maskDatabaseUrl,
  runMigrationVerification,
  validateVerificationConfig,
  type MigrationClient,
} from './gcp-runtime-migration-verifier';

describe('gcp-runtime-migration-verifier', () => {
  it('requires an explicit verification database URL with safe usage guidance', () => {
    expect(() => buildVerificationConfig({})).toThrow(
      'GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL is required for apply verification. Use a local or disposable shadow database. Do not point this at production or shared staging.',
    );
  });

  it('allows local database URLs without the remote override', () => {
    const config = buildVerificationConfig({
      GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
        'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    });

    expect(validateVerificationConfig(config)).toEqual({
      allowed: true,
      reason: 'local database host',
    });
  });

  it('refuses remote database URLs unless explicitly allowed', () => {
    const config = buildVerificationConfig({
      GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
        'postgres://postgres:secret@db.example.supabase.co:5432/postgres',
    });

    expect(validateVerificationConfig(config)).toEqual({
      allowed: false,
      reason:
        'remote database host requires GCP_RUNTIME_MIGRATION_VERIFY_ALLOW_REMOTE=true',
    });
  });

  it('requires remote database names to look like a disposable verification database', () => {
    const config = buildVerificationConfig({
      GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
        'postgres://postgres:secret@db.example.supabase.co:5432/prod',
      GCP_RUNTIME_MIGRATION_VERIFY_ALLOW_REMOTE: 'true',
    });

    expect(validateVerificationConfig(config)).toEqual({
      allowed: false,
      reason:
        'remote verification database name must include shadow, verify, test, or local',
    });
  });

  it('allows explicitly approved disposable remote verification databases', () => {
    const config = buildVerificationConfig({
      GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
        'postgres://postgres:secret@db.example.supabase.co:5432/alphaci_shadow',
      GCP_RUNTIME_MIGRATION_VERIFY_ALLOW_REMOTE: 'true',
    });

    expect(validateVerificationConfig(config)).toEqual({
      allowed: true,
      reason: 'remote verification override with disposable database name',
    });
  });

  it('masks database credentials in logs', () => {
    expect(
      maskDatabaseUrl('postgres://postgres:secret@localhost:5432/postgres'),
    ).toBe('postgres://postgres:***@localhost:5432/postgres');
  });

  it('formats a verification plan without printing the database URL value', () => {
    const config = buildVerificationConfig({
      GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
        'postgres://postgres:secret@localhost:5432/postgres',
    });

    expect(
      formatVerificationPlan(config, validateVerificationConfig(config)),
    ).toEqual([
      'Database URL source: GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL',
      'Database target: postgres://postgres:***@localhost:5432/postgres',
      'Migration file: supabase/migrations/20260701_gcp_runtime_expand_contract.sql',
      'Rollback file: supabase/rollbacks/20260701_gcp_runtime_expand_contract_down.sql',
      'Safety gate: local database host',
      'Production/shared safety: use only a local or disposable shadow database.',
    ]);
  });

  it('checks runtime tables after migration and after rollback', async () => {
    const queries: string[] = [];
    const client: MigrationClient = {
      connect: jest.fn(),
      end: jest.fn(),
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('to_regclass') && sql.includes('after migration')) {
          return {
            rows: [{ exists: 'runtime_deployments.deployment_targets' }],
          };
        }
        if (sql.includes('to_regclass') && sql.includes('after rollback')) {
          return { rows: [{ exists: null }] };
        }
        return { rows: [] };
      }),
    };

    await runMigrationVerification(
      buildVerificationConfig({
        GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
          'postgres://postgres:postgres@127.0.0.1:54322/postgres',
      }),
      client,
    );

    expect(queries.some((sql) => sql.includes('20260701_gcp_runtime'))).toBe(
      false,
    );
    expect(queries.join('\n')).toContain(
      'runtime_deployments.deployment_targets',
    );
    expect(queries.join('\n')).toContain('gcp_operations.provisioning_jobs');
  });

  it('names the failed table check when migration verification fails', async () => {
    const client: MigrationClient = {
      connect: jest.fn(),
      end: jest.fn(),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass') && sql.includes('after migration')) {
          return { rows: [{ exists: null }] };
        }
        return { rows: [] };
      }),
    };

    await expect(
      runMigrationVerification(
        buildVerificationConfig({
          GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL:
            'postgres://postgres:postgres@127.0.0.1:54322/postgres',
        }),
        client,
      ),
    ).rejects.toThrow(
      'Schema/table check failed after migration: runtime_deployments.deployment_targets was not created',
    );
  });
});
