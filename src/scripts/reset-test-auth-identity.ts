import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client, type QueryResult, type QueryResultRow } from 'pg';

import { postgresSslConfig } from '../modules/database/postgres-ssl.config';

const DEFAULT_TARGETS = ['antoneeeeetorres', 'antoneeeeetorres@gmail.com'];

export interface ResetAuthIdentityConfig {
  targets: string[];
  execute: boolean;
  envFile: string;
  databaseUrl?: string;
  dbCaCert?: string;
  dbSslRejectUnauthorized: boolean;
}

export interface ResetAuthIdentityUser {
  id: string;
  login: string | null;
  email: string | null;
  provider: string | null;
  githubUserId: string | null;
}

export interface ResetAuthIdentityCounts {
  userIdentities: number;
  githubInstallationAccounts: number;
  githubInstallationRepos: number;
  emailVerificationCodes: number;
}

export interface ResetAuthIdentityResult {
  dryRun: boolean;
  targets: string[];
  users: ResetAuthIdentityUser[];
  counts: ResetAuthIdentityCounts;
  deletedUsers: ResetAuthIdentityUser[];
  deletedEmailVerificationCodes: number;
}

export interface QueryClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

interface UserRow {
  id: string;
  login: string | null;
  email: string | null;
  provider: string | null;
  github_user_id: string | null;
}

interface CountRow {
  user_identities: string;
  github_installation_accounts: string;
  github_installation_repos: string;
  email_verification_codes: string;
}

interface DeletedEmailCodeRow {
  id: string;
}

export const FIND_MATCHING_USERS_SQL = `
WITH target(value) AS (
  SELECT DISTINCT lower(trim(value))
  FROM unnest($1::text[]) AS raw(value)
  WHERE trim(value) <> ''
),
matched AS (
  SELECT u.id, u.login, u.email, u.provider, u.github_user_id
  FROM identity.app_users u
  WHERE EXISTS (
    SELECT 1
    FROM target t
    WHERE lower(u.login) = t.value
       OR lower(COALESCE(u.email, '')) = t.value
       OR lower(split_part(COALESCE(u.email, ''), '@', 1)) = t.value
       OR lower(COALESCE(u.github_user_id, '')) = t.value
  )

  UNION

  SELECT u.id, u.login, u.email, u.provider, u.github_user_id
  FROM identity.user_identities ui
  JOIN identity.app_users u ON u.id = ui.user_id
  WHERE EXISTS (
    SELECT 1
    FROM target t
    WHERE lower(ui.provider_user_id) = t.value
       OR lower(COALESCE(ui.email, '')) = t.value
       OR lower(split_part(COALESCE(ui.email, ''), '@', 1)) = t.value
       OR lower(COALESCE(ui.normalized_email, '')) = t.value
       OR lower(split_part(COALESCE(ui.normalized_email, ''), '@', 1)) = t.value
  )

  UNION

  SELECT u.id, u.login, u.email, u.provider, u.github_user_id
  FROM github_app.github_installation_accounts account
  JOIN identity.app_users u ON u.id = account.user_id
  WHERE lower(COALESCE(account.account_login, '')) IN (SELECT value FROM target)

  UNION

  SELECT u.id, u.login, u.email, u.provider, u.github_user_id
  FROM github_app.github_installations installation
  JOIN identity.app_users u ON u.id = installation.user_id
  WHERE lower(COALESCE(installation.account_login, '')) IN (SELECT value FROM target)
     OR lower(split_part(COALESCE(installation.repo_full_name, ''), '/', 1)) IN (SELECT value FROM target)
)
SELECT DISTINCT id::text, login, email, provider, github_user_id
FROM matched
ORDER BY login NULLS LAST, email NULLS LAST;
`;

export const COUNT_DEPENDENCIES_SQL = `
WITH target(value) AS (
  SELECT DISTINCT lower(trim(value))
  FROM unnest($2::text[]) AS raw(value)
  WHERE trim(value) <> ''
)
SELECT
  (
    SELECT COUNT(*)::text
    FROM identity.user_identities
    WHERE user_id = ANY($1::uuid[])
  ) AS user_identities,
  (
    SELECT COUNT(*)::text
    FROM github_app.github_installation_accounts
    WHERE user_id = ANY($1::uuid[])
  ) AS github_installation_accounts,
  (
    SELECT COUNT(*)::text
    FROM github_app.github_installations
    WHERE user_id = ANY($1::uuid[])
  ) AS github_installation_repos,
  (
    SELECT COUNT(*)::text
    FROM identity.email_verification_codes code
    WHERE EXISTS (
      SELECT 1
      FROM target t
      WHERE lower(code.normalized_email) = t.value
         OR lower(split_part(code.normalized_email, '@', 1)) = t.value
    )
  ) AS email_verification_codes;
`;

export const DELETE_EMAIL_CODES_SQL = `
WITH target(value) AS (
  SELECT DISTINCT lower(trim(value))
  FROM unnest($1::text[]) AS raw(value)
  WHERE trim(value) <> ''
)
DELETE FROM identity.email_verification_codes code
WHERE EXISTS (
  SELECT 1
  FROM target t
  WHERE lower(code.normalized_email) = t.value
     OR lower(split_part(code.normalized_email, '@', 1)) = t.value
)
RETURNING id::text;
`;

export const DELETE_USERS_SQL = `
DELETE FROM identity.app_users
WHERE id = ANY($1::uuid[])
RETURNING id::text, login, email, provider, github_user_id;
`;

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ResetAuthIdentityConfig {
  const targets: string[] = [];
  let execute = false;
  let envFile = '.env.local';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--execute') {
      execute = true;
      continue;
    }

    if (arg === '--dry-run') {
      execute = false;
      continue;
    }

    if (arg === '--target') {
      const next = argv[index + 1];
      if (!next) throw new Error('--target requires a value');
      targets.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith('--target=')) {
      targets.push(arg.slice('--target='.length));
      continue;
    }

    if (arg === '--env-file') {
      const next = argv[index + 1];
      if (!next) throw new Error('--env-file requires a value');
      envFile = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      throw new Error(usage());
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const envTargets = env['RESET_TEST_AUTH_TARGETS']
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    targets: normalizeTargets(
      targets.length > 0 ? targets : (envTargets ?? DEFAULT_TARGETS),
    ),
    execute,
    envFile,
    ...(env['SUPABASE_DB_URL'] ? { databaseUrl: env['SUPABASE_DB_URL'] } : {}),
    ...(env['SUPABASE_DB_CA_CERT']
      ? { dbCaCert: env['SUPABASE_DB_CA_CERT'] }
      : {}),
    dbSslRejectUnauthorized:
      env['SUPABASE_DB_SSL_REJECT_UNAUTHORIZED'] === 'false' ? false : true,
  };
}

export function normalizeTargets(targets: string[]): string[] {
  return Array.from(
    new Set(
      targets
        .map((target) => target.trim().toLowerCase())
        .filter((target) => target.length > 0),
    ),
  );
}

export function loadEnvFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    return;
  }

  for (const line of readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (env[key] === undefined) {
      env[key] = value.replaceAll('\\n', '\n');
    }
  }
}

export async function runAuthIdentityReset(
  config: ResetAuthIdentityConfig,
  client: QueryClient,
): Promise<ResetAuthIdentityResult> {
  if (config.targets.length === 0) {
    throw new Error('At least one cleanup target is required.');
  }

  await client.connect();

  try {
    const usersResult = await client.query<UserRow>(FIND_MATCHING_USERS_SQL, [
      config.targets,
    ]);
    const users = usersResult.rows.map(toUser);
    const userIds = users.map((user) => user.id);
    const counts = await countDependencies(client, userIds, config.targets);

    if (!config.execute || userIds.length === 0) {
      return {
        dryRun: true,
        targets: config.targets,
        users,
        counts,
        deletedUsers: [],
        deletedEmailVerificationCodes: 0,
      };
    }

    await client.query('BEGIN');
    try {
      const emailCodeResult = await client.query<DeletedEmailCodeRow>(
        DELETE_EMAIL_CODES_SQL,
        [config.targets],
      );
      const deletedUsersResult = await client.query<UserRow>(DELETE_USERS_SQL, [
        userIds,
      ]);
      await client.query('COMMIT');

      return {
        dryRun: false,
        targets: config.targets,
        users,
        counts,
        deletedUsers: deletedUsersResult.rows.map(toUser),
        deletedEmailVerificationCodes: emailCodeResult.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const prelimConfig = parseArgs(argv, env);
  loadEnvFile(prelimConfig.envFile, env);
  const config = parseArgs(argv, env);

  if (!config.databaseUrl) {
    throw new Error(
      'SUPABASE_DB_URL is required. Set it in the environment or .env.local.',
    );
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: postgresSslConfig(
      config.databaseUrl,
      config.dbCaCert,
      config.dbSslRejectUnauthorized,
    ),
  });

  const result = await runAuthIdentityReset(config, client);
  printResult(result);
}

function toUser(row: UserRow): ResetAuthIdentityUser {
  return {
    id: row.id,
    login: row.login,
    email: row.email,
    provider: row.provider,
    githubUserId: row.github_user_id,
  };
}

async function countDependencies(
  client: QueryClient,
  userIds: string[],
  targets: string[],
): Promise<ResetAuthIdentityCounts> {
  if (userIds.length === 0) {
    return {
      userIdentities: 0,
      githubInstallationAccounts: 0,
      githubInstallationRepos: 0,
      emailVerificationCodes: 0,
    };
  }

  const result = await client.query<CountRow>(COUNT_DEPENDENCIES_SQL, [
    userIds,
    targets,
  ]);
  const row = result.rows[0];

  return {
    userIdentities: Number(row?.user_identities ?? 0),
    githubInstallationAccounts: Number(row?.github_installation_accounts ?? 0),
    githubInstallationRepos: Number(row?.github_installation_repos ?? 0),
    emailVerificationCodes: Number(row?.email_verification_codes ?? 0),
  };
}

function printResult(result: ResetAuthIdentityResult): void {
  const mode = result.dryRun ? 'DRY RUN' : 'EXECUTE';
  console.info(`[reset-auth] Mode: ${mode}`);
  console.info(`[reset-auth] Targets: ${result.targets.join(', ')}`);
  console.info(`[reset-auth] Matched users: ${result.users.length}`);

  for (const user of result.users) {
    console.info(
      `[reset-auth] - ${user.id} login=${user.login ?? '(none)'} email=${
        user.email ?? '(none)'
      } provider=${user.provider ?? '(none)'}`,
    );
  }

  console.info(
    `[reset-auth] Related rows: identities=${result.counts.userIdentities}, githubAccounts=${result.counts.githubInstallationAccounts}, githubRepos=${result.counts.githubInstallationRepos}, emailCodes=${result.counts.emailVerificationCodes}`,
  );

  if (result.dryRun) {
    console.info('[reset-auth] No rows were deleted. Re-run with --execute.');
    return;
  }

  console.info(
    `[reset-auth] Deleted users: ${result.deletedUsers.length}; deleted email verification codes: ${result.deletedEmailVerificationCodes}.`,
  );
}

function usage(): string {
  return [
    'Usage: npm run auth:reset-test-identity -- [--execute] [--target value]',
    '',
    'Defaults to a dry run for antoneeeeetorres and antoneeeeetorres@gmail.com.',
    'Use --execute to delete matched identity.app_users rows and cascading auth/GitHub rows.',
  ].join('\n');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      '[reset-auth] Fatal error:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
