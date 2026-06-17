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
      options: `-c search_path=${SERVICE_SCHEMA_SEARCH_PATH}`,
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
    return pool.query<T>(text, values);
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
