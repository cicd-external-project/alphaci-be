import { CiTokensRepository } from './ci-tokens.repository';
import { DatabaseService } from '../database/database.service';

const makeDatabaseService = () =>
  ({
    query: jest.fn(),
  }) as unknown as DatabaseService;

describe('CiTokensRepository', () => {
  let databaseService: DatabaseService;
  let repository: CiTokensRepository;

  beforeEach(() => {
    databaseService = makeDatabaseService();
    repository = new CiTokensRepository(databaseService);
  });

  it('stores only the token hash for a project token', async () => {
    (databaseService.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await repository.upsertProjectToken({
      projectId: 'project-1',
      tokenHash: 'sha256-token',
      tokenPrefix: 'fci_123456',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO project_ci_tokens'),
      ['project-1', 'sha256-token', 'fci_123456'],
    );
  });

  it('loads an active token with project and subscription context', async () => {
    const row = {
      project_id: 'project-1',
      user_id: 'user-1',
      repo_full_name: 'owner/repo',
      project_status: 'provisioned',
      token_status: 'active',
      subscription_status: 'active',
    };
    (databaseService.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

    const result = await repository.findValidationContext(
      'sha256-token',
      'owner/repo',
    );

    expect(result).toEqual(row);
    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN provisioned_projects'),
      ['sha256-token', 'owner/repo'],
    );
  });

  it('revokes active tokens for a project', async () => {
    (databaseService.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await repository.revokeProjectTokens('project-1');

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'revoked'"),
      ['project-1'],
    );
  });
});
