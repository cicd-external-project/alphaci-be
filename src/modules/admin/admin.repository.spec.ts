import type { DatabaseService } from '../database/database.service';
import { AdminRepository } from './admin.repository';

const makeDatabaseService = (query: jest.Mock) =>
  ({ query }) as unknown as DatabaseService;

describe('AdminRepository GCP runtime admin queries', () => {
  it('lists GCP runtime projects without selecting secret-bearing columns', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new AdminRepository(makeDatabaseService(query));

    await repository.listGcpRuntimeProjects({
      status: 'blocked_by_access',
      runtimePlacement: 'shared_project',
      owner: 'anton',
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM runtime_deployments.deployment_targets');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('latest_job');
    expect(sql).toContain('latest_domain');
    expect(sql).toContain('latest_audit');
    expect(sql).not.toContain('encrypted_value');
    expect(sql).not.toContain('provider_token');
    expect(sql).not.toContain('secret_value');
    expect(params).toEqual([
      'blocked_by_access',
      'shared_project',
      '%anton%',
      100,
    ]);
  });
});
