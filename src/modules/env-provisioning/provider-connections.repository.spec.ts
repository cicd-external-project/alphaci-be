import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import { ProviderConnectionsRepository } from './provider-connections.repository';

const row = {
  id: 'connection-1',
  provider: 'render',
  label: 'Render main',
  token_last_four: 'cret',
  status: 'active',
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
  last_used_at: null,
};

describe('ProviderConnectionsRepository', () => {
  it('stores only encrypted provider tokens', async () => {
    const database = {
      query: jest.fn().mockResolvedValue({ rows: [row] }),
    } as unknown as DatabaseService;
    const module = await Test.createTestingModule({
      providers: [
        ProviderConnectionsRepository,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    const repository = module.get(ProviderConnectionsRepository);
    await repository.createProviderConnection({
      userId: 'user-1',
      provider: 'render',
      label: 'Render main',
      encryptedToken: 'encrypted-token',
      tokenLastFour: 'cret',
    });

    const call = (
      database.query as jest.MockedFunction<DatabaseService['query']>
    ).mock.calls[0];
    const queryText = String(call?.[0] ?? '');
    const queryValues = call?.[1] ?? [];
    expect(queryText).toContain(
      'INSERT INTO env_provisioning.provider_connections',
    );
    expect(queryText).toContain('encrypted_token');
    expect(queryValues).toContain('encrypted-token');
    expect(queryValues).not.toContain('plain-token');
  });

  it('keeps the database BYO guard limited to new provider connection inserts', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../..',
        'supabase/migrations/20260702_block_new_byo_provider_connections.sql',
      ),
      'utf8',
    );
    const rollback = readFileSync(
      join(
        __dirname,
        '../../..',
        'supabase/rollbacks/20260702_block_new_byo_provider_connections_down.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'BEFORE INSERT ON env_provisioning.provider_connections',
    );
    expect(migration).not.toMatch(
      /delete\s+from\s+env_provisioning\.provider_connections/i,
    );
    expect(migration).not.toContain('project_env_var_metadata');
    expect(rollback).toContain(
      'DROP TRIGGER IF EXISTS reject_new_legacy_provider_connections ON env_provisioning.provider_connections',
    );
  });
});
