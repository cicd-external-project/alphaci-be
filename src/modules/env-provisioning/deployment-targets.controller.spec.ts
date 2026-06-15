import { DeploymentTargetsController } from './deployment-targets.controller';
import type { DeploymentTargetsService } from './deployment-targets.service';

describe('DeploymentTargetsController', () => {
  const makeService = () =>
    ({
      listDeploymentTargets: jest.fn().mockResolvedValue([{ id: 'target-1' }]),
      createDeploymentTarget: jest.fn().mockResolvedValue({ id: 'target-2' }),
      getDeploymentTargetActions: jest.fn().mockResolvedValue({ actions: [] }),
      syncDeploymentTarget: jest.fn().mockResolvedValue({ synced: true }),
      updateDeploymentTargetMetadata: jest
        .fn()
        .mockResolvedValue({ id: 'target-1', branchName: 'test' }),
      detachDeploymentTarget: jest.fn().mockResolvedValue({ detached: true }),
    }) as unknown as jest.Mocked<DeploymentTargetsService>;

  const request = { session: { user: { id: 'user-1' } } } as never;

  it('lists deployment targets for the current user project', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);

    await expect(controller.list(request, 'project-1')).resolves.toEqual([
      { id: 'target-1' },
    ]);
    expect(service.listDeploymentTargets).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
  });

  it('creates a deployment target for the current user project', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);
    const body = { slot: 'frontend', provider: 'render' } as never;

    await expect(
      controller.create(request, 'project-1', body),
    ).resolves.toEqual({
      id: 'target-2',
    });
    expect(service.createDeploymentTarget).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      body,
    );
  });

  it('returns target actions for the current user', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);

    await expect(
      controller.actions(request, 'project-1', 'target-1'),
    ).resolves.toEqual({ actions: [] });
    expect(service.getDeploymentTargetActions).toHaveBeenCalledWith(
      'project-1',
      'target-1',
      'user-1',
    );
  });

  it('syncs a deployment target for the current user', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);

    await expect(
      controller.sync(request, 'project-1', 'target-1'),
    ).resolves.toEqual({ synced: true });
    expect(service.syncDeploymentTarget).toHaveBeenCalledWith(
      'project-1',
      'target-1',
      'user-1',
    );
  });

  it('updates deployment target metadata for the current user', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);
    const body = { branchName: 'test' };

    await expect(
      controller.update(request, 'project-1', 'target-1', body),
    ).resolves.toEqual({ id: 'target-1', branchName: 'test' });
    expect(service.updateDeploymentTargetMetadata).toHaveBeenCalledWith(
      'project-1',
      'target-1',
      'user-1',
      body,
    );
  });

  it('detaches deployment target metadata for the current user', async () => {
    const service = makeService();
    const controller = new DeploymentTargetsController(service);

    await expect(
      controller.detach(request, 'project-1', 'target-1'),
    ).resolves.toEqual({ detached: true });
    expect(service.detachDeploymentTarget).toHaveBeenCalledWith(
      'project-1',
      'target-1',
      'user-1',
    );
  });
});
