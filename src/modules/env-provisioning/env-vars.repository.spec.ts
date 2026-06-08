import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import { EnvVarsRepository } from './env-vars.repository';

describe('EnvVarsRepository', () => {
  it('persists env metadata without env values', async () => {
    const database = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseService;
    const module = await Test.createTestingModule({
      providers: [
        EnvVarsRepository,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    const repository = module.get(EnvVarsRepository);
    await repository.upsertEnvMetadataBatch({
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      environment: 'test',
      provider: 'render',
      provisionedBy: 'user-1',
      entries: [
        {
          key: 'DATABASE_URL',
          status: 'provisioned',
          errorSummary: null,
        },
      ],
    });

    const call = (
      database.query as jest.MockedFunction<DatabaseService['query']>
    ).mock.calls[0];
    const queryText = String(call?.[0] ?? '');
    const queryValues = call?.[1] ?? [];
    expect(queryText).toContain('INSERT INTO project_env_var_metadata');
    expect(queryValues).toContain('DATABASE_URL');
    expect(queryValues).not.toContain('postgres://secret');
  });
});
