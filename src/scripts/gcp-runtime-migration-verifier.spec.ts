import {
  buildVerificationConfig,
  maskDatabaseUrl,
  validateVerificationConfig,
} from './gcp-runtime-migration-verifier';

describe('gcp-runtime-migration-verifier', () => {
  it('requires an explicit verification database URL', () => {
    expect(() => buildVerificationConfig({})).toThrow(
      'GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL is required',
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
});
