import { UnauthorizedException } from '@nestjs/common';

import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesController', () => {
  const makeConfigService = (enabled = true) =>
    ({
      getOrThrow: jest.fn().mockReturnValue({
        workspaces: { enabled },
      }),
    }) as never;
  const makeService = () =>
    ({
      getMyWorkspaces: jest.fn().mockResolvedValue({
        enabled: true,
        items: [
          {
            id: 'workspace-1',
            name: "tone's workspace",
            kind: 'personal',
            role: 'owner',
          },
        ],
      }),
    }) as unknown as jest.Mocked<WorkspacesService>;

  it('returns persisted workspaces for the current user', async () => {
    const service = makeService();
    const controller = new WorkspacesController(makeConfigService(), service);

    await expect(
      controller.getMyWorkspaces({
        session: { user: { id: 'user-1', login: 'tone' } },
      } as never),
    ).resolves.toEqual({
      enabled: true,
      items: [
        {
          id: 'workspace-1',
          name: "tone's workspace",
          kind: 'personal',
          role: 'owner',
        },
      ],
    });
    expect(service.getMyWorkspaces).toHaveBeenCalledWith('user-1');
  });

  it('rejects unauthenticated workspace requests', () => {
    const controller = new WorkspacesController(makeConfigService(), makeService());

    expect(() =>
      controller.getMyWorkspaces({ session: {} } as never),
    ).toThrow(UnauthorizedException);
  });

  it('returns disabled workspace contract when workspaces are disabled', () => {
    const service = makeService();
    const controller = new WorkspacesController(makeConfigService(false), service);

    expect(
      controller.getMyWorkspaces({
        session: { userId: 'user-1' },
      } as never),
    ).toEqual({ enabled: false, items: [] });
    expect(service.getMyWorkspaces).not.toHaveBeenCalled();
  });
});
