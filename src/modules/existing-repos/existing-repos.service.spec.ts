import { readFile } from 'node:fs/promises';

import type { CatalogService } from '../catalog/catalog.service.js';
import type { GithubService } from '../github/github.service.js';
import { ExistingReposService } from './existing-repos.service.js';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;

const makeGithubService = () =>
  ({
    getInstallationAccessTokenForUser: jest.fn().mockResolvedValue('app-token'),
    getFileContent: jest.fn().mockResolvedValue(
      JSON.stringify({
        dependencies: { next: '16.0.0' },
        devDependencies: { typescript: '5.0.0' },
      }),
    ),
    createBranch: jest.fn().mockResolvedValue(undefined),
    putFileContent: jest.fn().mockResolvedValue({
      commitSha: 'commit-sha',
      commitUrl: 'https://github.com/tone/app/commit/commit-sha',
    }),
    createPullRequest: jest.fn().mockResolvedValue({
      number: 42,
      htmlUrl: 'https://github.com/tone/app/pull/42',
    }),
  }) as unknown as GithubService;

const makeCatalogService = () =>
  ({
    getProjectOptions: jest.fn().mockReturnValue({
      recipes: [
        {
          id: 'standard',
          templateByProjectType: {
            nextjs: 'nextjs-service-pipeline',
            nestjs: 'nest-service-pipeline',
          },
        },
      ],
    }),
    getTemplateById: jest.fn().mockResolvedValue({
      id: 'nextjs-service-pipeline',
      name: 'Next.js Service',
      workflowPath: 'workflow-templates/nextjs-service-pipeline.yml',
    }),
  }) as unknown as CatalogService;

describe('ExistingReposService', () => {
  let githubService: GithubService;
  let service: ExistingReposService;

  beforeEach(() => {
    githubService = makeGithubService();
    service = new ExistingReposService(githubService, makeCatalogService());
    mockedReadFile.mockResolvedValue(`
name: Service CI
on:
  workflow_dispatch:
    inputs: {}
jobs:
  pipeline:
    with: {}
`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('discovers an existing repo and recommends a workflow plan', async () => {
    const result = await service.discover('user-1', null, {
      repoFullName: 'tone/app',
      baseBranch: 'main',
    });

    expect(githubService.getInstallationAccessTokenForUser).toHaveBeenCalledWith(
      'user-1',
    );
    expect(githubService.getFileContent).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'app',
      'package.json',
      'main',
    );
    expect(result).toMatchObject({
      repoFullName: 'tone/app',
      baseBranch: 'main',
      detectedProjectTypeId: 'nextjs',
      recommendedWorkflowRecipeId: 'standard',
      serviceName: 'app',
      servicePath: '.',
    });
  });

  it('creates a setup branch and pull request for an existing repo', async () => {
    const result = await service.setupPullRequest('user-1', null, {
      repoFullName: 'tone/app',
      baseBranch: 'main',
      projectTypeId: 'nextjs',
      workflowRecipeId: 'standard',
      serviceName: 'app',
      servicePath: '.',
      outputFileName: 'ci.yml',
    });

    expect(githubService.createBranch).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'app',
      'flowci/app-ci',
      'main',
    );
    expect(githubService.putFileContent).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'app',
      '.github/workflows/ci.yml',
      expect.stringContaining('app - Next.js Service'),
      'flowci/app-ci',
      'ci: add FlowCI Studio workflow',
    );
    expect(githubService.createPullRequest).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'app',
      expect.objectContaining({
        head: 'flowci/app-ci',
        base: 'main',
      }),
    );
    expect(result).toEqual({
      repoFullName: 'tone/app',
      branchName: 'flowci/app-ci',
      workflowPath: '.github/workflows/ci.yml',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/tone/app/pull/42',
    });
  });
});
