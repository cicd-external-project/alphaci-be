import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueryResult, QueryResultRow } from 'pg';

import {
  DELETE_EMAIL_CODES_SQL,
  DELETE_USERS_SQL,
  FIND_MATCHING_USERS_SQL,
  loadEnvFile,
  parseArgs,
  runAuthIdentityReset,
  type QueryClient,
} from './reset-test-auth-identity';

describe('reset-test-auth-identity', () => {
  it('defaults to a dry run for the recurring test identity', () => {
    const config = parseArgs([], {});

    expect(config.execute).toBe(false);
    expect(config.targets).toEqual([
      'antoneeeeetorres',
      'antoneeeeetorres@gmail.com',
    ]);
  });

  it('parses explicit targets and execute mode', () => {
    const config = parseArgs(
      ['--execute', '--target', ' Tone ', '--target=Tone@Example.test'],
      {},
    );

    expect(config.execute).toBe(true);
    expect(config.targets).toEqual(['tone', 'tone@example.test']);
  });

  it('loads env files without overriding existing environment values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reset-auth-env-'));
    const envFile = join(dir, '.env.local');
    const env: NodeJS.ProcessEnv = {
      SUPABASE_DB_URL: 'postgres://existing.example/db',
    };

    writeFileSync(
      envFile,
      [
        'SUPABASE_DB_URL=postgres://from-file.example/db',
        'SUPABASE_DB_CA_CERT="line1\\nline2"',
      ].join('\n'),
    );

    try {
      loadEnvFile(envFile, env);

      expect(env.SUPABASE_DB_URL).toBe('postgres://existing.example/db');
      expect(env.SUPABASE_DB_CA_CERT).toBe('line1\nline2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dry-runs matching users and related rows without deleting', async () => {
    const client = buildFakeClient({
      users: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          login: 'antoneeeeetorres',
          email: 'antoneeeeetorres@gmail.com',
          provider: 'email',
          github_user_id: null,
        },
      ],
      countRow: {
        user_identities: '2',
        github_installation_accounts: '1',
        github_installation_repos: '3',
        email_verification_codes: '1',
      },
    });

    const result = await runAuthIdentityReset(
      {
        targets: ['antoneeeeetorres'],
        execute: false,
        envFile: '.env.local',
        databaseUrl: 'postgres://localhost/db',
        dbSslRejectUnauthorized: false,
      },
      client,
    );

    expect(result.dryRun).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(result.counts.githubInstallationRepos).toBe(3);
    expect(client.queries.map((query) => query.sql)).not.toContain(
      DELETE_USERS_SQL,
    );
  });

  it('deletes email codes and app users inside a transaction when execute is set', async () => {
    const client = buildFakeClient({
      users: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          login: 'antoneeeeetorres',
          email: 'antoneeeeetorres@gmail.com',
          provider: 'email',
          github_user_id: null,
        },
      ],
      deletedEmailCodes: [{ id: 'code-1' }],
      countRow: {
        user_identities: '1',
        github_installation_accounts: '1',
        github_installation_repos: '0',
        email_verification_codes: '1',
      },
    });

    const result = await runAuthIdentityReset(
      {
        targets: ['antoneeeeetorres'],
        execute: true,
        envFile: '.env.local',
        databaseUrl: 'postgres://localhost/db',
        dbSslRejectUnauthorized: false,
      },
      client,
    );

    expect(result.dryRun).toBe(false);
    expect(result.deletedUsers).toHaveLength(1);
    expect(result.deletedEmailVerificationCodes).toBe(1);
    expect(client.queries.map((query) => query.sql)).toEqual([
      FIND_MATCHING_USERS_SQL,
      expect.stringContaining('SELECT') as string,
      'BEGIN',
      DELETE_EMAIL_CODES_SQL,
      DELETE_USERS_SQL,
      'COMMIT',
    ]);
  });
});

interface FakeClientFixtures {
  users: Array<{
    id: string;
    login: string | null;
    email: string | null;
    provider: string | null;
    github_user_id: string | null;
  }>;
  countRow: {
    user_identities: string;
    github_installation_accounts: string;
    github_installation_repos: string;
    email_verification_codes: string;
  };
  deletedEmailCodes?: Array<{ id: string }>;
}

interface FakeClient extends QueryClient {
  queries: Array<{ sql: string; values?: unknown[] }>;
}

function buildFakeClient(fixtures: FakeClientFixtures): FakeClient {
  const client: FakeClient = {
    queries: [],
    connect: jest.fn(),
    end: jest.fn(),
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: unknown[],
    ): Promise<QueryResult<T>> => {
      client.queries.push(values === undefined ? { sql } : { sql, values });

      if (sql === FIND_MATCHING_USERS_SQL) {
        return queryResult(fixtures.users, fixtures.users.length);
      }

      if (sql.includes('github_installation_accounts')) {
        return queryResult([fixtures.countRow], 1);
      }

      if (sql === DELETE_EMAIL_CODES_SQL) {
        const rows = fixtures.deletedEmailCodes ?? [];
        return queryResult(rows, rows.length);
      }

      if (sql === DELETE_USERS_SQL) {
        return queryResult(fixtures.users, fixtures.users.length);
      }

      return queryResult([], null);
    },
  };

  return client;
}

function queryResult<T extends QueryResultRow>(
  rows: QueryResultRow[],
  rowCount: number | null,
): QueryResult<T> {
  return {
    command: 'SELECT',
    oid: 0,
    fields: [],
    rows: rows as T[],
    rowCount,
  };
}
