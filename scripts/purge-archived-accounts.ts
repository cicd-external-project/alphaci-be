/**
 * scripts/purge-archived-accounts.ts
 *
 * Standalone script that calls the DB-side retention purge function and logs
 * how many archived accounts were permanently deleted.
 *
 * @nestjs/schedule is NOT installed in this project. Wire this script to an
 * external scheduler instead:
 *
 *   OS cron (daily at 03:00):
 *     0 3 * * *  cd /app && npx ts-node --project tsconfig.json scripts/purge-archived-accounts.ts
 *
 *   pg_cron (inside Supabase / Postgres):
 *     SELECT cron.schedule('purge-archived-accounts', '0 3 * * *',
 *       $$SELECT purge_expired_archived_accounts(30)$$);
 *
 * Environment variable:
 *   ARCHIVED_ACCOUNT_RETENTION_DAYS  — defaults to 30 if not set.
 *   SUPABASE_DB_URL                  — required; the direct-connection URL.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/purge-archived-accounts.ts
 */

import { Client } from 'pg';

const retentionDays = Number(
  process.env['ARCHIVED_ACCOUNT_RETENTION_DAYS'] ?? 30,
);
const dbUrl = process.env['SUPABASE_DB_URL'];

if (!dbUrl) {
  console.error('[purge] SUPABASE_DB_URL is not set — aborting.');
  process.exit(1);
}

async function run(): Promise<void> {
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log(
      `[purge] Running purge_expired_archived_accounts(${retentionDays})…`,
    );

    const result = await client.query<{ count: string }>(
      'SELECT purge_expired_archived_accounts($1) AS count;',
      [retentionDays],
    );

    const count = Number(result.rows[0]?.count ?? 0);
    console.log(
      `[purge] Permanently deleted ${count} expired archived account(s).`,
    );
  } finally {
    await client.end();
  }
}

run().catch((err: unknown) => {
  console.error(
    '[purge] Fatal error:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
