import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from 'pg';

const DEFAULT_MIGRATION_PATH =
  'supabase/migrations/20260701_gcp_runtime_expand_contract.sql';
const DEFAULT_ROLLBACK_PATH =
  'supabase/rollbacks/20260701_gcp_runtime_expand_contract_down.sql';
const DISPOSABLE_REMOTE_DATABASE_NAME = /(shadow|verify|test|local)/i;
const VERIFY_DATABASE_URL_ENV = 'GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL';
const MISSING_DATABASE_URL_MESSAGE =
  'GCP_RUNTIME_MIGRATION_VERIFY_DATABASE_URL is required for apply verification. Use a local or disposable shadow database. Do not point this at production or shared staging.';

const REQUIRED_RUNTIME_TABLES = [
  'runtime_deployments.deployment_targets',
  'runtime_deployments.deployment_attempts',
  'runtime_domains.domain_records',
  'runtime_secrets.secret_references',
  'gcp_operations.provisioning_jobs',
  'billing_lifecycle.runtime_cost_summaries',
];

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

interface TableCheckResult {
  rows?: Array<{
    exists?: unknown;
  }>;
}

export function buildVerificationConfig(
  env: NodeJS.ProcessEnv,
): VerificationConfig {
  const databaseUrl = env[VERIFY_DATABASE_URL_ENV];

  if (!databaseUrl) {
    throw new Error(MISSING_DATABASE_URL_MESSAGE);
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

export function formatVerificationPlan(
  config: VerificationConfig,
  decision: VerificationDecision,
): string[] {
  return [
    `Database URL source: ${VERIFY_DATABASE_URL_ENV}`,
    `Database target: ${maskDatabaseUrl(config.databaseUrl)}`,
    `Migration file: ${config.migrationPath}`,
    `Rollback file: ${config.rollbackPath}`,
    `Safety gate: ${decision.reason}`,
    'Production/shared safety: use only a local or disposable shadow database.',
  ];
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

  const migrationSql = await readSqlFile(config.migrationPath, 'migration');
  const rollbackSql = await readSqlFile(config.rollbackPath, 'rollback');

  await client.connect();

  try {
    await client.query(migrationSql);
    await assertRuntimeTables(client, 'after migration', true);
    await client.query(rollbackSql);
    await assertRuntimeTables(client, 'after rollback', false);
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

  for (const line of formatVerificationPlan(config, decision)) {
    console.info(line);
  }

  await runMigrationVerification(config);

  console.info('GCP runtime migration apply/rollback verification passed');
}

async function readSqlFile(path: string, kind: 'migration' | 'rollback') {
  try {
    return await readFile(resolve(path), 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read ${kind} file ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function assertRuntimeTables(
  client: MigrationClient,
  phase: 'after migration' | 'after rollback',
  shouldExist: boolean,
): Promise<void> {
  for (const tableName of REQUIRED_RUNTIME_TABLES) {
    const result = (await client.query(
      `SELECT to_regclass('${tableName}') AS exists; -- ${phase}`,
    )) as TableCheckResult;
    const exists = result.rows?.[0]?.exists ?? null;

    if (shouldExist && exists === null) {
      throw new Error(
        `Schema/table check failed ${phase}: ${tableName} was not created`,
      );
    }

    if (!shouldExist && exists !== null) {
      throw new Error(
        `Schema/table check failed ${phase}: ${tableName} still exists`,
      );
    }
  }
}
