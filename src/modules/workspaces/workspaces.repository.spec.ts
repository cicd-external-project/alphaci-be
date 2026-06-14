import type { DatabaseService } from '../database/database.service';
import { WorkspacesRepository } from './workspaces.repository';

const makeDatabaseService = (query: jest.Mock) =>
  ({ query }) as unknown as DatabaseService;

describe('WorkspacesRepository', () => {
  let query: jest.Mock;
  let repository: WorkspacesRepository;

  beforeEach(() => {
    query = jest.fn();
    repository = new WorkspacesRepository(makeDatabaseService(query));
  });

  it('lists workspaces for a user membership', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'workspace-1',
          name: 'Personal workspace',
          kind: 'personal',
          role: 'owner',
        },
      ],
    });

    await expect(repository.listForUser('user-1')).resolves.toEqual([
      {
        id: 'workspace-1',
        name: 'Personal workspace',
        kind: 'personal',
        role: 'owner',
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM orgs.workspace_members'),
      ['user-1'],
    );
  });

  it('creates a personal workspace and owner membership', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'workspace-1',
            name: 'Personal workspace',
            kind: 'personal',
            role: 'owner',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.createPersonalWorkspace('user-1')).resolves.toEqual(
      {
        id: 'workspace-1',
        name: 'Personal workspace',
        kind: 'personal',
        role: 'owner',
      },
    );
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO orgs.workspaces'),
      ['user-1'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO orgs.workspace_members'),
      ['workspace-1', 'user-1'],
    );
  });

  it('throws when workspace insert does not return a row', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(repository.createPersonalWorkspace('user-1')).rejects.toThrow(
      'Workspace insert did not return a row',
    );
  });
});
