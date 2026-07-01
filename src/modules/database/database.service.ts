import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

import type { AppConfig } from '../../config/app.config';
import { postgresSslConfig } from './postgres-ssl.config.js';

const SERVICE_SCHEMA_SEARCH_PATH = [
  'identity',
  'billing',
  'github_app',
  'projects',
  'platform',
  'workflow',
  'ci',
  'env_provisioning',
  'runtime_deployments',
  'runtime_domains',
  'runtime_secrets',
  'billing_lifecycle',
  'gcp_operations',
  'public',
].join(',');

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly config: AppConfig;
  private readonly pool: Pool | null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow<AppConfig>('app');

    if (!this.config.supabase.dbUrl) {
      this.pool = null;
      this.logger.warn(
        'SUPABASE_DB_URL is missing. Database-backed features are disabled.',
      );
      return;
    }

    this.pool = new Pool({
      connectionString: this.config.supabase.dbUrl,
      ssl: postgresSslConfig(
        this.config.supabase.dbUrl,
        this.config.supabase.dbCaCert,
      ),
      max: 10,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      idleTimeoutMillis: 30_000,
      // Keep idle TCP connections alive. Render → Supabase traffic crosses a
      // load balancer / NAT that silently drops idle sockets; without keepalive
      // the next query on a reaped connection throws "Connection terminated" /
      // ECONNRESET. This was the root cause of intermittent 500s on the OAuth
      // callback, whose first DB call (oauth_states lookup) was the first to hit
      // a stale connection.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      options: `-c search_path=${SERVICE_SCHEMA_SEARCH_PATH}`,
    });

    // pg emits 'error' on IDLE clients when the server or network drops them
    // out from under the pool. Without a handler this error is unhandled and
    // can crash the Node process. We only need to log it — pg automatically
    // removes the dead client from the pool, and the next query acquires a
    // fresh connection.
    this.pool.on('error', (err) => {
      this.logger.warn(
        `Idle Postgres client error (connection dropped, will be replaced): ${err.message}`,
      );
    });
  }

  isEnabled(): boolean {
    return this.pool !== null;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const pool = this.getPoolOrThrow();

    try {
      return await pool.query<T>(text, values);
    } catch (error) {
      // A pooled connection can go stale between requests (idle reaped by the
      // Supabase pooler / network). The first query to use it throws a
      // connection-level error. pg has already discarded the bad client, so a
      // single retry transparently acquires a fresh connection. We retry only
      // for connection-level failures — never for query/constraint errors,
      // which would be wrong to re-run.
      if (!this.isRetryableConnectionError(error)) {
        throw error;
      }
      this.logger.warn(
        `Postgres query hit a stale connection; retrying once: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return await pool.query<T>(text, values);
    }
  }

  /**
   * True for transport/connection-level failures that are safe to retry on a
   * fresh connection (the statement never reached the server, or the server
   * went away). Deliberately excludes SQL errors (syntax, constraint, etc.).
   */
  private isRetryableConnectionError(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    // Postgres connection-failure SQLSTATEs + Node socket error codes.
    const retryableCodes = new Set([
      '08000', // connection_exception
      '08003', // connection_does_not_exist
      '08006', // connection_failure
      '57P01', // admin_shutdown
      '57P02', // crash_shutdown
      '57P03', // cannot_connect_now
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'ENOTFOUND',
    ]);
    if (retryableCodes.has(code)) {
      return true;
    }

    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    return (
      message.includes('connection terminated') ||
      message.includes('server closed the connection') ||
      message.includes('connection ended unexpectedly') ||
      message.includes('client has encountered a connection error')
    );
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = this.getPoolOrThrow();
    const client = await pool.connect();

    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.end();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private getPoolOrThrow(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Database is not configured. Set SUPABASE_DB_URL.',
      );
    }

    return this.pool;
  }
}
