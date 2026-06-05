import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

interface OAuthStateRow {
  return_to: string;
  provider: string;
}

@Injectable()
export class OAuthStateRepository {
  private readonly logger = new Logger(OAuthStateRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async save(state: string, returnTo: string, provider: string): Promise<void> {
    const result = await this.databaseService.query(
      `
        INSERT INTO oauth_states (state, return_to, provider)
        VALUES ($1, $2, $3);
      `,
      [state, returnTo, provider],
    );

    if (result.rowCount === 0) {
      throw new Error('OAuth state insert returned no affected rows');
    }
  }

  async findAndDelete(
    state: string,
  ): Promise<{ returnTo: string; provider: string } | null> {
    const result = await this.databaseService.query<OAuthStateRow>(
      `
        DELETE FROM oauth_states
        WHERE state = $1
          AND expires_at > NOW()
        RETURNING return_to, provider;
      `,
      [state],
    );

    const row = result.rows[0];
    if (!row) {
      this.logger.warn(
        `OAuth state not found or expired: ${state.slice(0, 8)}…`,
      );
      return null;
    }

    return { returnTo: row.return_to, provider: row.provider };
  }
}
