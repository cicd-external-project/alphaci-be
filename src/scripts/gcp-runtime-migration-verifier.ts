import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from 'pg';

const DEFAULT_MIGRATION_PATH =
  'supabase/migrations/20260701_gcp_runtime_expand_contract.sql';
const DEFAULT_ROLLBACK_PATH =
  'supabase/rollbacks/20260701_gcp_runtime_expand_contract_down.sql';
const DISPOSABLE_REMOTE_DATABASE_NAME = /(shadow|verify|test|local)/i;

export interface VerificationConfig {
  databaseUrl: string;
  allowRemote: boolean;
  migrationPath: string;
  rollbackPath: string;
}

export interface VerificationDecision {
  allowed: boolean;
  reason: string;
}

export interface MigrationClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query(sql: string): Promise<unknown>;
}

export function buildVerificationConfig(
  env: NodeJS.ProcessEnv,
): VerificationConfig {
  const databaseUrl = env.GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL is required');
  }

  return {
    databaseUrl,
    allowRemote: env.GCP_RUNTIME_MIGRATION_VERIFY_ALLOW_REMOTE === 'true',
    migrationPath:
      env.GCP_RUNTIME_MIGRATION_VERIFY_MIGRATION_PATH ?? DEFAULT_MIGRATION_PATH,
    rollbackPath:
      env.GCP_RUNTIME_MIGRATION_VERIFY_ROLLBACK_PATH ?? DEFAULT_ROLLBACK_PATH,
  };
}

export function validateVerificationConfig(
  config: VerificationConfig,
): VerificationDecision {
  const url = new URL(config.databaseUrl);
  const host = url.hostname.toLowerCase();
  const databaseName = url.pathname.replace(/^\//, '');
  const isLocalHost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (isLocalHost) {
    return { allowed: true, reason: 'local database host' };
  }

  if (!config.allowRemote) {
    return {
      allowed: false,
      reason:
        'remote database host requires GCP_RUNTIME_MIGRATION_VERIFY_ALLOW_REMOTE=true',
    };
  }

  if (!DISPOSABLE_REMOTE_DATABASE_NAME.test(databaseName)) {
    return {
      allowed: false,
      reason:
        'remote verification database name must include shadow, verify, test, or local',
    };
  }

  return {
    allowed: true,
    reason: 'remote verification override with disposable database name',
  };
}

export function maskDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);

  if (url.password) {
    url.password = '***';
  }

  return url.toString();
}

export async function runMigrationVerification(
  config: VerificationConfig,
  client: MigrationClient = new Client({
    connectionString: config.databaseUrl,
  }),
): Promise<void> {
  const decision = validateVerificationConfig(config);

  if (!decision.allowed) {
    throw new Error(`Refusing migration verification: ${decision.reason}`);
  }

  const migrationSql = await readFile(resolve(config.migrationPath), 'utf8');
  const rollbackSql = await readFile(resolve(config.rollbackPath), 'utf8');

  await client.connect();

  try {
    await client.query(migrationSql);
    await client.query(rollbackSql);
  } finally {
    await client.end();
  }
}

export async function main(env: NodeJS.ProcessEnv = process.env) {
  const config = buildVerificationConfig(env);
  const decision = validateVerificationConfig(config);

  if (!decision.allowed) {
    throw new Error(`Refusing migration verification: ${decision.reason}`);
  }

  console.info(
    `Verifying GCP runtime migration against ${maskDatabaseUrl(
      config.databaseUrl,
    )}`,
  );
  console.info(`Safety gate: ${decision.reason}`);

  await runMigrationVerification(config);

  console.info('GCP runtime migration apply/rollback verification passed');
}
