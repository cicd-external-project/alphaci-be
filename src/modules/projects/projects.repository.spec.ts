import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service.js';
import {
  ProjectsRepository,
  type ProvisionedProjectRow,
} from './projects.repository.js';

const fakeRow: ProvisionedProjectRow = {
  id: 'project-1',
  user_id: 'user-1',
  repo_full_name: 'tone/orders-api',
  template_id: 'be-nestjs',
  service_name: 'orders-api',
  workflow_path: '.github/workflows/ci.yml',
  status: 'provisioned',
  github_commit_sha: 'commit-sha',
  github_commit_url: 'https://github.com/tone/orders-api/commit/commit-sha',
  failure_reason: null,
  repo_url: 'https://github.com/tone/orders-api',
  visibility: 'private',
  repo_shape: 'single-app',
  project_type_id: 'nestjs-api',
  workflow_recipe_id: 'backend-api-ci',
  project_options: { lint: true },
  created_at: '2026-06-05T00:00:00.000Z',
  updated_at: '2026-06-05T00:00:00.000Z',
};

const makeDatabaseService = (rows: ProvisionedProjectRow[] = [fakeRow]) =>
  ({
    query: jest.fn().mockResolvedValue({ rows }),
  }) as unknown as DatabaseService;

describe('ProjectsRepository', () => {
  let repo: ProjectsRepository;
  let db: DatabaseService;

  beforeEach(async () => {
    db = makeDatabaseService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsRepository,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    repo = module.get(ProjectsRepository);
  });

  it('creates a provisioned project row', async () => {
    const result = await repo.create({
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      workflowPath: '.github/workflows/ci.yml',
      status: 'provisioned',
      githubCommitSha: 'commit-sha',
      githubCommitUrl: 'https://github.com/tone/orders-api/commit/commit-sha',
      repoUrl: 'https://github.com/tone/orders-api',
      visibility: 'private',
      repoShape: 'single-app',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      projectOptions: { lint: true },
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO projects.provisioned_projects'),
      expect.arrayContaining([
        'user-1',
        'tone/orders-api',
        'be-nestjs',
        'orders-api',
        '.github/workflows/ci.yml',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        'commit-sha',
        'provisioned',
        'commit-sha',
        'https://github.com/tone/orders-api/commit/commit-sha',
        null,
        expect.stringContaining(
          '"repoUrl":"https://github.com/tone/orders-api"',
        ),
        expect.any(String),
        null,
        'tone',
        'orders-api',
        'https://github.com/tone/orders-api',
        'private',
        'single-app',
        'nestjs-api',
        'backend-api-ci',
        'be-nestjs',
        JSON.stringify({ lint: true }),
        null,
      ]),
    );
    const [query, values] = (db.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    const columnsMatch = query.match(
      /INSERT INTO projects\.provisioned_projects \(([\s\S]*?)\)\s*VALUES/,
    );
    const placeholdersMatch = query.match(/VALUES \(([\s\S]*?)\)\s*RETURNING/);

    if (!columnsMatch?.[1] || !placeholdersMatch?.[1]) {
      throw new Error('Project insert query shape changed unexpectedly');
    }

    const columns =
      columnsMatch[1]
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean) ?? [];
    const placeholders = placeholdersMatch[1].match(/\$\d+/g) ?? [];

    expect(columns).toHaveLength(values.length);
    expect(placeholders).toHaveLength(values.length);
    expect(result).toEqual(fakeRow);
  });

  it('throws when insert returns no row', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(
      repo.create({
        userId: 'user-1',
        repoFullName: 'tone/orders-api',
        templateId: 'be-nestjs',
        serviceName: 'orders-api',
        workflowPath: '.github/workflows/ci.yml',
        status: 'provisioned',
      }),
    ).rejects.toThrow('provisioned_projects INSERT returned no row');
  });

  it('lists project rows for a user', async () => {
    const result = await repo.listByUser('user-1', 10);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM projects.provisioned_projects'),
      ['user-1', 10],
    );
    expect(result).toEqual([fakeRow]);
  });

  it('lists project rows through workspace membership and selected workspace', async () => {
    await repo.listByUser('user-2', 10, 'workspace-1');

    const [query, values] = (db.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(query).toContain('orgs.workspace_members');
    expect(query).toContain('workspace_id = $3');
    expect(values).toEqual(['user-2', 10, 'workspace-1']);
  });

  it('clamps list limit to 100', async () => {
    await repo.listByUser('user-1', 999);

    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['user-1', 100]);
  });

  it('defaults list limit to 25 for invalid input', async () => {
    await repo.listByUser('user-1', NaN);

    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['user-1', 25]);
  });

  it('finds a project by id scoped to user', async () => {
    const result = await repo.findByIdAndUser('project-1', 'user-1');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      ['project-1', 'user-1'],
    );
    expect(result).toEqual(fakeRow);
  });

  it('finds a project by id through workspace membership', async () => {
    await repo.findByIdAndUser('project-1', 'user-2');

    const [query] = (db.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(query).toContain('orgs.workspace_members');
    expect(query).toContain('member.workspace_id');
  });

  it('defaults isExample to false when creating a real project', async () => {
    await repo.create({
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      workflowPath: '.github/workflows/ci.yml',
      status: 'provisioned',
    });

    const [query, values] = (db.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(query).toContain('is_example');
    expect(values[values.length - 1]).toBe(false);
  });

  it('persists isExample = true when explicitly requested', async () => {
    await repo.create({
      userId: 'user-1',
      repoFullName: 'flowci-demo/flowci-demo-app',
      templateId: 'nest-service-pipeline',
      serviceName: 'flowci-demo-backend',
      workflowPath:
        '.github/workflows/flowci-demo-backend-nest-service-pipeline.yml',
      status: 'provisioned',
      visibility: 'public',
      isExample: true,
    });

    const [, values] = (db.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(values[values.length - 1]).toBe(true);
  });

  it('hasExampleProject returns true when a row is found', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

    const result = await repo.hasExampleProject('user-1');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_example = true'),
      ['user-1'],
    );
    expect(result).toBe(true);
  });

  it('hasExampleProject returns false when no row is found', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await repo.hasExampleProject('user-1');

    expect(result).toBe(false);
  });
});
