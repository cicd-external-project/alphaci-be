import { AdminController } from './admin.controller';

describe('AdminController GCP runtime routes', () => {
  it('passes filters and actor identity to the admin service', () => {
    const adminService = {
      listGcpRuntimeProjects: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0 }),
    };
    const controller = new AdminController(adminService as never);

    void controller.listGcpRuntimeProjects(
      { session: { user: { id: 'admin-1' } } } as never,
      {
        status: 'drifted',
        runtimePlacement: 'shared_project',
        owner: 'anton',
      },
    );

    expect(adminService.listGcpRuntimeProjects).toHaveBeenCalledWith(
      'admin-1',
      {
        status: 'drifted',
        runtimePlacement: 'shared_project',
        owner: 'anton',
      },
    );
  });
});
