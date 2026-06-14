import type { WorkspacesRepository } from './workspaces.repository';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  const makeRepository = () =>
    ({
      listForUser: jest.fn().mockResolvedValue([]),
      createPersonalWorkspace: jest.fn().mockResolvedValue({
        id: 'workspace-1',
        name: 'Personal workspace',
        kind: 'personal',
        role: 'owner',
      }),
    }) as unknown as jest.Mocked<WorkspacesRepository>;

  it('returns existing workspaces without creating a personal workspace', async () => {
    const repository = makeRepository();
    repository.listForUser.mockResolvedValueOnce([
      {
        id: 'workspace-2',
        name: 'Team workspace',
        kind: 'team',
        role: 'developer',
      },
    ]);
    const service = new WorkspacesService(repository);

    await expect(service.getMyWorkspaces('user-1')).resolves.toEqual({
      enabled: true,
      items: [
        {
          id: 'workspace-2',
          name: 'Team workspace',
          kind: 'team',
          role: 'developer',
        },
      ],
    });
    expect(repository.createPersonalWorkspace).not.toHaveBeenCalled();
  });

  it('creates a personal workspace when the user has none', async () => {
    const repository = makeRepository();
    const service = new WorkspacesService(repository);

    await expect(service.getMyWorkspaces('user-1')).resolves.toEqual({
      enabled: true,
      items: [
        {
          id: 'workspace-1',
          name: 'Personal workspace',
          kind: 'personal',
          role: 'owner',
        },
      ],
    });
    expect(repository.createPersonalWorkspace).toHaveBeenCalledWith('user-1');
  });
});
