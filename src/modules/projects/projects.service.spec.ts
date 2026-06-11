import { readFile } from 'node:fs/promises';

import { UnauthorizedException } from '@nestjs/common';

import type { CatalogService } from '../catalog/catalog.service.js';
import type { CiService } from '../ci/ci.service.js';
import type { GithubService } from '../github/github.service.js';
import type { ProjectsRepository } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;

const makeCatalogService = () =>
  ({
    getProjectOptions: jest.fn().mockReturnValue({
      recipes: [
        {
          id: 'backend-api-ci',
          templateByProjectType: { 'nestjs-api': 'be-nestjs' },
        },
      ],
    }),
    getTemplateById: jest.fn().mockResolvedValue({
      id: 'be-nestjs',
      name: 'Backend API',
      workflowPath: 'workflow-templates/be-nestjs.yml',
    }),
  }) as unknown as CatalogService;

const makeGithubService = () =>
  ({
    getInstallationAccessTokenForUser: jest.fn().mockResolvedValue('app-token'),
    createRepo: jest.fn().mockResolvedValue({
      repoUrl: 'https://github.com/tone/orders-api',
      cloneUrl: 'https://github.com/tone/orders-api.git',
      ownerLogin: 'tone',
      repoName: 'orders-api',
    }),
    createBranch: jest.fn().mockResolvedValue(undefined),
    applyBranchProtection: jest.fn().mockResolvedValue(undefined),
    setActionsSecret: jest.fn().mockResolvedValue(undefined),
  }) as unknown as GithubService;

const makeProjectsRepository = () =>
  ({
    create: jest.fn().mockResolvedValue({
      id: 'project-1',
    }),
  }) as unknown as ProjectsRepository;

const makeCiService = () =>
  ({
    issueProjectToken: jest.fn().mockResolvedValue({
      token: 'flowci-token',
    }),
  }) as unknown as CiService;

describe('ProjectsService', () => {
  let service: ProjectsService;
  let githubService: GithubService;
  let githubServiceMock: {
    getInstallationAccessTokenForUser: jest.Mock;
    createRepo: jest.Mock;
  };
  let projectDeploymentProvisioningService: {
    provisionForProject: jest.Mock;
  };
  let pushWorkflowFileSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedReadFile.mockResolvedValue(`
name: CI
on:
  workflow_dispatch:
    inputs: {}
jobs:
  pipeline:
    with: {}
`);

    githubService = makeGithubService();
    githubServiceMock = githubService as unknown as {
      getInstallationAccessTokenForUser: jest.Mock;
      createRepo: jest.Mock;
    };
    projectDeploymentProvisioningService = {
      provisionForProject: jest.fn().mockResolvedValue({
        status: 'skipped',
        targets: [],
      }),
    };
    service = new ProjectsService(
      makeCatalogService(),
      githubService,
      makeProjectsRepository(),
      makeCiService(),
      projectDeploymentProvisioningService as never,
    );

    pushWorkflowFileSpy = jest
      .spyOn(
        service as unknown as {
          pushWorkflowFile: (
            accessToken: string,
            owner: string,
            repo: string,
            filePath: string,
            content: string,
          ) => Promise<{ commitSha: string; commitUrl: string | null }>;
        },
        'pushWorkflowFile',
      )
      .mockResolvedValue({
        commitSha: 'commit-sha',
        commitUrl: 'https://github.com/tone/orders-api/commit/commit-sha',
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers a linked GitHub App installation token for project provisioning', async () => {
    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-api',
      visibility: 'private',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
      servicePath: '.',
      nodeVersion: '24',
      coverageThreshold: 80,
    });

    expect(
      githubServiceMock.getInstallationAccessTokenForUser,
    ).toHaveBeenCalledWith('user-1');
    expect(githubServiceMock.createRepo).toHaveBeenCalledWith(
      'app-token',
      expect.objectContaining({ repoName: 'orders-api' }),
    );
  });

  it('falls back to the OAuth token when no installation token is available', async () => {
    githubServiceMock.getInstallationAccessTokenForUser.mockResolvedValueOnce(
      null,
    );

    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-api',
      visibility: 'private',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
    });

    expect(githubServiceMock.createRepo).toHaveBeenCalledWith(
      'oauth-token',
      expect.any(Object),
    );
  });

  it('throws an actionable error when no GitHub token source is available', async () => {
    githubServiceMock.getInstallationAccessTokenForUser.mockResolvedValueOnce(
      null,
    );

    await expect(
      service.createProject('user-1', 'tone', null, {
        repoName: 'orders-api',
        visibility: 'private',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-api',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('generates BYO Vercel deploy jobs for frontend single-repo creation', async () => {
    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-ui',
      visibility: 'private',
      projectTypeId: 'react-app',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-ui',
      servicePath: 'apps/web',
      deploymentProvisioning: {
        enabled: true,
        targets: [
          {
            slot: 'frontend',
            provider: 'vercel',
            ownershipMode: 'byo',
            projectName: 'orders-ui-test',
            rootDirectory: 'apps/web',
            providerConnectionId: 'connection-1',
            env: [],
          },
        ],
      },
    });

    const packageWorkflow = (
      (
        service as unknown as {
          pushWorkflowFile: jest.Mock;
        }
      ).pushWorkflowFile.mock.calls as Array<
        [string, string, string, string, string]
      >
    ).find(([, , , path]) => path.endsWith('20-flowci-package.yml'));

    expect(packageWorkflow?.[4]).toContain('deploy-vercel-frontend');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_TOKEN');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_ORG_ID');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_PROJECT_ID');
  });

  it('generates BYO Vercel deploy jobs for frontend single-repo setup', async () => {
    await service.setupProject('user-1', 'oauth-token', {
      repoFullName: 'tone/orders-ui',
      templateId: 'be-nestjs',
      serviceName: 'orders-ui',
      servicePath: 'apps/web',
      nodeVersion: '24',
      coverageThreshold: 80,
      deploymentProvisioning: {
        enabled: true,
        targets: [
          {
            slot: 'frontend',
            provider: 'vercel',
            ownershipMode: 'byo',
            projectName: 'orders-ui-test',
            rootDirectory: 'apps/web',
            providerConnectionId: 'connection-1',
            env: [],
          },
        ],
      },
    });

    const packageWorkflow = (
      (
        service as unknown as {
          pushWorkflowFile: jest.Mock;
        }
      ).pushWorkflowFile.mock.calls as Array<
        [string, string, string, string, string]
      >
    ).find(([, , , path]) => path.endsWith('20-flowci-package.yml'));

    expect(packageWorkflow?.[4]).toContain('deploy-vercel-frontend');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_TOKEN');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_ORG_ID');
    expect(packageWorkflow?.[4]).toContain('VERCEL_FRONTEND_PROJECT_ID');
  });

  it('provisions deployment targets after the GitHub project row exists', async () => {
    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-api',
      visibility: 'private',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
      deploymentProvisioning: {
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
          },
        ],
      },
    });

    expect(
      projectDeploymentProvisioningService.provisionForProject,
    ).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      githubAccessToken: 'app-token',
      request: {
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
          },
        ],
      },
    });
  });

  it('returns the GitHub project when provider provisioning fails', async () => {
    projectDeploymentProvisioningService.provisionForProject.mockResolvedValueOnce(
      {
        status: 'failed',
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            status: 'failed',
            deploymentTargetId: null,
            providerProjectId: null,
            providerProjectName: null,
            errorSummary: 'Render service could not be created: 401',
            env: [],
          },
        ],
      },
    );

    const result = await service.createProject(
      'user-1',
      'tone',
      'oauth-token',
      {
        repoName: 'orders-api',
        visibility: 'private',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-api',
        deploymentProvisioning: {
          enabled: true,
          targets: [
            {
              slot: 'backend',
              provider: 'render',
              ownershipMode: 'flowci_managed',
              projectName: 'orders-api-test',
            },
          ],
        },
      },
    );

    expect(result.repoFullName).toBe('tone/orders-api');
    expect(result.deploymentProvisioning.status).toBe('failed');
  });

  it('records the actual staged workflow path even when a custom outputFileName is supplied', async () => {
    const result = await service.createProject(
      'user-1',
      'tone',
      'oauth-token',
      {
        repoName: 'orders-api',
        visibility: 'private',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-api',
        outputFileName: 'ci.yml',
      },
    );

    expect(result.workflowPath).toBe('.github/workflows/00-flowci-access.yml');
  });

  it("dispatches the catalog shape ID 'multi' to the multi-repo flow (two repos)", async () => {
    const result = await service.createProject(
      'user-1',
      'tone',
      'oauth-token',
      {
        repoName: 'orders',
        visibility: 'private',
        repoShape: 'multi',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-backend',
        multiRepoConfig: {
          backend: {
            projectTypeId: 'nestjs-api',
            workflowRecipeId: 'backend-api-ci',
            serviceName: 'orders-backend',
            servicePath: 'backend/',
          },
          frontend: {
            projectTypeId: 'nestjs-api',
            workflowRecipeId: 'backend-api-ci',
            serviceName: 'orders-frontend',
            servicePath: 'frontend/',
          },
        },
      },
    );

    expect(githubServiceMock.createRepo).toHaveBeenCalledTimes(2);
    expect(githubServiceMock.createRepo).toHaveBeenNthCalledWith(
      1,
      'app-token',
      expect.objectContaining({ repoName: 'orders-be' }),
    );
    expect(githubServiceMock.createRepo).toHaveBeenNthCalledWith(
      2,
      'app-token',
      expect.objectContaining({ repoName: 'orders-fe' }),
    );
    expect(result.secondaryRepoFullName).toBeDefined();
  });

  it("renders the monorepo scaffold for the catalog shape ID 'mono'", async () => {
    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders',
      visibility: 'private',
      repoShape: 'mono',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-platform',
    });

    const pushedPaths = (
      pushWorkflowFileSpy.mock.calls as unknown as Array<
        [string, string, string, string, string]
      >
    ).map((call) => call[3]);
    expect(pushedPaths).toContain('packages/core/package.json');
  });

  it('pushes variant-suffixed workflow files for the microservices shape so the slots do not collide', async () => {
    await service.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders',
      visibility: 'private',
      repoShape: 'microservices',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-backend',
      microservicesConfig: {
        backend: {
          projectTypeId: 'nestjs-api',
          workflowRecipeId: 'backend-api-ci',
          serviceName: 'orders-backend',
          servicePath: 'backend/',
        },
        frontend: {
          projectTypeId: 'nestjs-api',
          workflowRecipeId: 'backend-api-ci',
          serviceName: 'orders-frontend',
          servicePath: 'frontend/',
        },
      },
    });

    const pushedPaths = (
      pushWorkflowFileSpy.mock.calls as unknown as Array<
        [string, string, string, string, string]
      >
    ).map((call) => call[3]);

    expect(pushedPaths).toEqual(
      expect.arrayContaining([
        '.github/workflows/00-flowci-access-backend.yml',
        '.github/workflows/10-flowci-quality-backend.yml',
        '.github/workflows/20-flowci-package-backend.yml',
        '.github/workflows/00-flowci-access-frontend.yml',
        '.github/workflows/10-flowci-quality-frontend.yml',
        '.github/workflows/20-flowci-package-frontend.yml',
      ]),
    );
    // The unsuffixed paths would mean one slot overwrote the other.
    expect(pushedPaths).not.toContain('.github/workflows/00-flowci-access.yml');
    expect(pushedPaths).not.toContain(
      '.github/workflows/10-flowci-quality.yml',
    );
    expect(pushedPaths).not.toContain(
      '.github/workflows/20-flowci-package.yml',
    );
  });
});
