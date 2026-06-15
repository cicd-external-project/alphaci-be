import type { WorkspacesRepository } from './workspaces.repository';
import type { WorkspaceAccessService } from './workspace-access.service';
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
      listMembers: jest.fn().mockResolvedValue([]),
      addMemberByLoginOrEmail: jest.fn(),
      findMemberById: jest.fn(),
      updateMemberRole: jest.fn(),
      removeMember: jest.fn(),
    }) as unknown as jest.Mocked<WorkspacesRepository>;
  const makeAccessService = () =>
    ({
      assertWorkspaceRole: jest.fn().mockResolvedValue({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'owner',
      }),
      assertCanChangeOwnerRole: jest.fn().mockResolvedValue(undefined),
      assertCanRemoveMember: jest.fn().mockResolvedValue(undefined),
    }) as unknown as jest.Mocked<WorkspaceAccessService>;

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
    const service = new WorkspacesService(repository, makeAccessService());

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
    const service = new WorkspacesService(repository, makeAccessService());

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

  it('lists members after read access is verified', async () => {
    const repository = makeRepository();
    const accessService = makeAccessService();
    repository.listMembers.mockResolvedValueOnce([
      {
        id: 'member-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'owner',
        login: 'tone',
        name: 'Tone',
        email: null,
        avatarUrl: null,
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ]);
    const service = new WorkspacesService(repository, accessService);

    await expect(
      service.listMembers('workspace-1', 'user-1'),
    ).resolves.toHaveLength(1);
    expect(accessService.assertWorkspaceRole).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      ['owner', 'admin', 'developer', 'viewer'],
    );
  });

  it('adds a member after owner or admin access is verified', async () => {
    const repository = makeRepository();
    const accessService = makeAccessService();
    repository.addMemberByLoginOrEmail.mockResolvedValueOnce({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      role: 'developer',
      login: 'dev',
      name: 'Dev User',
      email: null,
      avatarUrl: null,
      createdAt: '2026-06-15T00:00:00.000Z',
    });
    const service = new WorkspacesService(repository, accessService);

    await expect(
      service.addMember('workspace-1', 'user-1', {
        loginOrEmail: 'dev',
        role: 'developer',
      }),
    ).resolves.toMatchObject({ userId: 'user-2', role: 'developer' });
    expect(accessService.assertWorkspaceRole).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      ['owner', 'admin'],
    );
  });

  it('blocks demoting the last owner before updating role', async () => {
    const repository = makeRepository();
    const accessService = makeAccessService();
    repository.findMemberById.mockResolvedValueOnce({
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      role: 'owner',
    });
    accessService.assertCanChangeOwnerRole.mockRejectedValueOnce(
      new Error('Workspace must keep at least one owner'),
    );
    const service = new WorkspacesService(repository, accessService);

    await expect(
      service.updateMemberRole('workspace-1', 'user-1', 'member-owner', 'admin'),
    ).rejects.toThrow('Workspace must keep at least one owner');
    expect(repository.updateMemberRole).not.toHaveBeenCalled();
  });

  it('removes a member after last-owner protection passes', async () => {
    const repository = makeRepository();
    repository.findMemberById.mockResolvedValueOnce({
      workspaceId: 'workspace-1',
      userId: 'user-2',
      role: 'developer',
    });
    repository.removeMember.mockResolvedValueOnce({ id: 'member-2' });
    const accessService = makeAccessService();
    const service = new WorkspacesService(repository, accessService);

    await expect(
      service.removeMember('workspace-1', 'user-1', 'member-2'),
    ).resolves.toEqual({ id: 'member-2', removed: true });
    expect(accessService.assertCanRemoveMember).toHaveBeenCalledWith(
      'workspace-1',
      { workspaceId: 'workspace-1', userId: 'user-2', role: 'developer' },
    );
  });
});
