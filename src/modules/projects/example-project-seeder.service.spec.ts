import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { ProjectsRepository } from './projects.repository.js';
import { ExampleProjectSeederService } from './example-project-seeder.service.js';

const makeProjectsRepository = (overrides?: Partial<ProjectsRepository>) =>
  ({
    hasExampleProject: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockResolvedValue({ id: 'demo-project-1' }),
    ...overrides,
  }) as unknown as ProjectsRepository;

async function createService(repoOverrides?: Partial<ProjectsRepository>) {
  const projectsRepository = makeProjectsRepository(repoOverrides);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ExampleProjectSeederService,
      { provide: ProjectsRepository, useValue: projectsRepository },
    ],
  }).compile();

  return {
    service: module.get(ExampleProjectSeederService),
    projectsRepository,
  };
}

describe('ExampleProjectSeederService', () => {
  it('inserts a demo project row on first call', async () => {
    const { service, projectsRepository } = await createService();

    await service.ensureExampleProjectSeeded('user-1');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.hasExampleProject).toHaveBeenCalledWith('user-1');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        repoFullName: 'flowci-demo/flowci-demo-app',
        serviceName: 'flowci-demo-backend',
        status: 'provisioned',
        visibility: 'public',
        isExample: true,
      }),
    );
  });

  it('is a no-op on a second call because hasExampleProject returns true', async () => {
    const { service, projectsRepository } = await createService({
      hasExampleProject: jest.fn().mockResolvedValue(true),
    });

    await service.ensureExampleProjectSeeded('user-1');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.create).not.toHaveBeenCalled();
  });

  it('catches and logs a repository error instead of throwing', async () => {
    const { service, projectsRepository } = await createService({
      create: jest.fn().mockRejectedValue(new Error('insert failed')),
    });

    await expect(
      service.ensureExampleProjectSeeded('user-1'),
    ).resolves.toBeUndefined();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.create).toHaveBeenCalled();
  });

  it('catches and logs an error from hasExampleProject instead of throwing', async () => {
    const { service } = await createService({
      hasExampleProject: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      service.ensureExampleProjectSeeded('user-1'),
    ).resolves.toBeUndefined();
  });

  it('works correctly when called for an existing/active user, not just new signups', async () => {
    const { service, projectsRepository } = await createService({
      hasExampleProject: jest.fn().mockResolvedValue(false),
    });

    // Defensive correctness: this method may be invoked for active users
    // too (e.g. if the hook point is ever broadened beyond the 'new' branch).
    await service.ensureExampleProjectSeeded('existing-user-42');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.hasExampleProject).toHaveBeenCalledWith(
      'existing-user-42',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(projectsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'existing-user-42' }),
    );
  });
});
