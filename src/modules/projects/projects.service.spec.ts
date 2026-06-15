import { readFile } from 'node:fs/promises';

import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { CatalogService } from '../catalog/catalog.service.js';
import type { CiService } from '../ci/ci.service.js';
import type { GithubService } from '../github/github.service.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';
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
    putFileContent: jest.fn().mockResolvedValue({
      commitSha: 'commit-sha',
      commitUrl: 'https://github.com/tone/orders-api/commit/commit-sha',
    }),
    createPullRequest: jest.fn().mockResolvedValue({
      number: 42,
      htmlUrl: 'https://github.com/tone/orders-api/pull/42',
    }),
    getRepo: jest.fn().mockResolvedValue({
      fullName: 'tone/orders-api',
      htmlUrl: 'https://github.com/tone/orders-api',
      defaultBranch: 'main',
      private: false,
    }),
    applyBranchProtection: jest.fn().mockResolvedValue(undefined),
    setActionsSecret: jest.fn().mockResolvedValue(undefined),
  }) as unknown as GithubService;

const makeProjectsRepository = () =>
  ({
    create: jest.fn().mockResolvedValue({
      id: 'project-1',
    }),
    listByUser: jest.fn().mockResolvedValue([]),
  }) as unknown as ProjectsRepository;

const makeCiService = () =>
  ({
    issueProjectToken: jest.fn().mockResolvedValue({
      token: 'flowci-token',
    }),
  }) as unknown as CiService;

const makeWorkspacesService = () =>
  ({
    getMyWorkspaces: jest.fn().mockResolvedValue({
      enabled: true,
      items: [
        {
          id: 'workspace-1',
          name: 'Personal workspace',
          kind: 'personal',
          role: 'owner',
        },
      ],
    }),
  }) as unknown as WorkspacesService;

const makeOverviewReadRepositories = () => ({
  ciTokensRepository: {
    findProjectTokenStatus: jest.fn().mockResolvedValue({
      status: 'active',
      tokenPrefix: 'fci_test',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
      revokedAt: null,
    }),
  },
  deploymentTargetsRepository: {
    listDeploymentTargets: jest.fn().mockResolvedValue([
      {
        id: 'target-1',
        projectId: 'project-1',
        slot: 'backend',
        ownershipMode: 'flowci_managed',
        provider: 'render',
        providerConnectionId: null,
        providerProjectId: 'srv-123',
        providerProjectName: 'orders-api-test',
        repoFullName: 'tone/orders-api',
        branchName: 'test',
        rootDirectory: '.',
        buildCommand: 'npm run build',
        startCommand: 'npm run start:prod',
        environmentMap: {},
        deploymentStrategy: 'render_image_pushed',
        providerMetadata: {},
        status: 'active',
      },
    ]),
  },
  envVarsRepository: {
    listEnvMetadata: jest.fn().mockResolvedValue([
      {
        id: 'env-1',
        projectId: 'project-1',
        deploymentTargetId: 'target-1',
        environment: 'test',
        key: 'DATABASE_URL',
        provider: 'render',
        valueStored: false,
        lastProvisionedAt: '2026-06-12T00:00:00.000Z',
        lastProvisionedBy: 'user-1',
        status: 'provisioned',
        errorSummary: null,
      },
    ]),
  },
  workflowHistoryRepository: {
    listByUser: jest.fn().mockResolvedValue([
      {
        id: 'history-1',
        createdAt: '2026-06-12T00:00:00.000Z',
        templateId: 'be-nestjs',
        templateName: 'Backend API',
        stack: 'nestjs',
        serviceName: 'orders-api',
        outputFileName: '00-flowci-access.yml',
        sourceWorkflowFile: 'workflow-templates/be-nestjs.yml',
        sourcePropertiesFile: 'workflow-templates/be-nestjs.properties',
        lineCount: 42,
        yaml: 'name: FlowCI Access Gate',
      },
      {
        id: 'history-other',
        createdAt: '2026-06-11T00:00:00.000Z',
        templateId: 'other',
        templateName: 'Other',
        stack: 'nodejs',
        serviceName: 'other',
        outputFileName: 'other.yml',
        sourceWorkflowFile: 'workflow-templates/other.yml',
        sourcePropertiesFile: 'workflow-templates/other.properties',
        lineCount: 10,
        yaml: 'name: Other',
      },
    ]),
    listForProjectIdentity: jest.fn().mockResolvedValue([
      {
        id: 'history-1',
        createdAt: '2026-06-12T00:00:00.000Z',
        templateId: 'be-nestjs',
        templateName: 'Backend API',
        stack: 'nestjs',
        serviceName: 'orders-api',
        outputFileName: '00-flowci-access.yml',
        sourceWorkflowFile: 'workflow-templates/be-nestjs.yml',
        sourcePropertiesFile: 'workflow-templates/be-nestjs.properties',
        lineCount: 42,
        yaml: 'name: FlowCI Access Gate',
      },
    ]),
  },
  dashboardSnapshotsRepository: {
    findLatestByProject: jest.fn().mockResolvedValue(null),
    createSnapshot: jest.fn().mockResolvedValue({
      id: 'snapshot-1',
      projectId: 'project-1',
      status: 'ok',
      summary: {
        mode: 'local_snapshot',
        projectId: 'project-1',
      },
      findings: [],
      startedAt: '2026-06-12T00:00:00.000Z',
      completedAt: '2026-06-12T00:00:01.000Z',
      createdBy: 'user-1',
      createdAt: '2026-06-12T00:00:01.000Z',
    }),
  },
  workflowSettingsRepository: {
    findByProject: jest.fn().mockResolvedValue(null),
  },
  workflowUpdateRequestsRepository: {
    createRequest: jest.fn().mockResolvedValue({
      id: 'request-1',
      projectId: 'project-1',
      branchName: 'flowci/workflow-update-20260612000000',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/tone/orders-api/pull/42',
      status: 'created',
    }),
  },
});

const makeProjectFeatureConfig = (options?: {
  syncSnapshots?: boolean;
  workflowSettingsPreview?: boolean;
  workflowUpdatePr?: boolean;
}) => ({
  getOrThrow: jest.fn().mockReturnValue({
    projectSyncSnapshots: {
      enabled: options?.syncSnapshots ?? true,
    },
    workflowSettingsPreview: {
      enabled: options?.workflowSettingsPreview ?? false,
    },
    workflowUpdatePr: {
      enabled: options?.workflowUpdatePr ?? false,
    },
  }),
});

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

  it('records audit and notification events after project creation', async () => {
    const auditEventsService = {
      recordProjectEvent: jest.fn(),
    };
    const notificationEventsService = {
      record: jest.fn(),
    };
    const eventService = new ProjectsService(
      makeCatalogService(),
      githubService,
      makeProjectsRepository(),
      makeCiService(),
      projectDeploymentProvisioningService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeProjectFeatureConfig(),
      undefined,
      undefined,
      undefined,
      auditEventsService as never,
      makeWorkspacesService(),
      notificationEventsService as never,
    );
    jest
      .spyOn(
        eventService as unknown as {
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

    await eventService.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-api',
      visibility: 'private',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
      servicePath: '.',
      nodeVersion: '24',
      coverageThreshold: 80,
    });

    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'project_created',
      }),
    );
    expect(notificationEventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        eventCode: 'project_created',
      }),
    );
  });

  it('records audit and notification events when project quota blocks creation', async () => {
    const usageQuotaService = {
      assertWithinLimit: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException({
            message: 'Usage quota exceeded',
            limitCode: 'projects',
          }),
        ),
    };
    const auditEventsService = {
      recordProjectEvent: jest.fn(),
    };
    const notificationEventsService = {
      record: jest.fn(),
    };
    const quotaService = new ProjectsService(
      makeCatalogService(),
      githubService,
      makeProjectsRepository(),
      makeCiService(),
      projectDeploymentProvisioningService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeProjectFeatureConfig(),
      undefined,
      undefined,
      usageQuotaService as never,
      auditEventsService as never,
      makeWorkspacesService(),
      notificationEventsService as never,
    );

    await expect(
      quotaService.createProject('user-1', 'tone', 'oauth-token', {
        repoName: 'orders-api',
        visibility: 'private',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-api',
        servicePath: '.',
        nodeVersion: '24',
        coverageThreshold: 80,
      }),
    ).rejects.toThrow('Usage quota exceeded');

    expect(githubServiceMock.createRepo).not.toHaveBeenCalled();
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: null,
        eventCode: 'quota_blocked',
      }),
    );
    expect(notificationEventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: null,
        eventCode: 'quota_blocked',
      }),
    );
  });

  it('attaches created projects to the default workspace when available', async () => {
    const projectsRepository = makeProjectsRepository() as jest.Mocked<ProjectsRepository>;
    const workspacesService =
      makeWorkspacesService() as jest.Mocked<WorkspacesService>;
    const workspaceService = new ProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workspacesService,
    );

    jest
      .spyOn(
        workspaceService as unknown as {
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

    await workspaceService.createProject('user-1', 'tone', 'oauth-token', {
      repoName: 'orders-api',
      visibility: 'private',
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
    });

    expect(workspacesService.getMyWorkspaces).toHaveBeenCalledWith('user-1');
    expect(projectsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
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

  it('passes selected workspace id into project listing', async () => {
    const projectsRepository = makeProjectsRepository() as jest.Mocked<ProjectsRepository>;
    const listService = new ProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService as never,
    );

    await listService.listProjects('user-1', 25, 'workspace-1');

    expect(projectsRepository.listByUser).toHaveBeenCalledWith(
      'user-1',
      25,
      'workspace-1',
    );
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

  it('generates managed Vercel deploy jobs for frontend single-repo creation', async () => {
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
            ownershipMode: 'flowci_managed',
            projectName: 'orders-ui-test',
            rootDirectory: 'apps/web',
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

  it('aggregates a project overview from stored project, workflow, target, env, CI token, and history data', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url:
          'https://github.com/tone/orders-api/commit/abc123456789',
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {
          workflowFiles: [
            {
              stage: 'access',
              name: 'FlowCI Access Gate',
              path: '.github/workflows/00-flowci-access.yml',
              gated: true,
            },
            {
              stage: 'quality',
              name: 'FlowCI Quality',
              path: '.github/workflows/10-flowci-quality.yml',
              gated: true,
            },
          ],
          lint: true,
        },
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const OverviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const overviewService = new OverviewProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ syncSnapshots: true }),
    ) as ProjectsService & {
      getProjectOverview: (
        projectId: string,
        userId: string,
      ) => Promise<{
        project: { id: string; repoFullName: string };
        workflow: { files: Array<{ path: string }>; stageCount: number };
        deploymentTargets: { items: unknown[]; count: number };
        environment: { items: Array<{ key: string }>; count: number };
        ciAuth: { status: string; tokenPresent: boolean };
        health: {
          checks: Array<{ key: string; status: string }>;
          summary: string;
        };
        capabilities: { envProvisioning: boolean; syncSnapshots: boolean };
        syncSnapshot: {
          enabled: boolean;
          mode: string;
          latest: unknown;
        };
      }>;
    };

    const overview = await overviewService.getProjectOverview(
      'project-1',
      'user-1',
    );

    expect(projectsRepository.findByIdAndUser).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(overview.project).toMatchObject({
      id: 'project-1',
      repoFullName: 'tone/orders-api',
    });
    expect(overview.workflow.stageCount).toBe(2);
    expect(overview.workflow.files.map((file) => file.path)).toEqual([
      '.github/workflows/00-flowci-access.yml',
      '.github/workflows/10-flowci-quality.yml',
    ]);
    expect(overview.deploymentTargets.count).toBe(1);
    expect(overview.environment.items).toEqual([
      expect.objectContaining({ key: 'DATABASE_URL' }),
    ]);
    expect(overview.ciAuth).toMatchObject({
      status: 'active',
      tokenPresent: true,
    });
    expect(overview.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'workflow_bundle', status: 'ok' }),
        expect.objectContaining({ key: 'ci_token', status: 'ok' }),
        expect.objectContaining({ key: 'deployment_targets', status: 'ok' }),
      ]),
    );
    expect(overview.health.summary).toBe('ok');
    expect(overview.capabilities.envProvisioning).toBe(true);
    expect(overview.capabilities.syncSnapshots).toBe(true);
    expect(overview.syncSnapshot).toEqual({
      enabled: true,
      mode: 'local_snapshot',
      latest: null,
    });
    expect(
      overviewRepos.dashboardSnapshotsRepository.findLatestByProject,
    ).toHaveBeenCalledWith('project-1');
    expect(
      overviewRepos.workflowHistoryRepository.listByUser,
    ).not.toHaveBeenCalled();
    expect(
      overviewRepos.workflowHistoryRepository.listForProjectIdentity,
    ).toHaveBeenCalledWith({
      userId: 'user-1',
      serviceName: 'orders-api',
      templateId: 'be-nestjs',
      limit: 5,
    });
  });

  it('lists project audit events from the audit service after ownership is verified', async () => {
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
      }),
    };
    const auditEventsService = {
      listProjectEvents: jest.fn().mockResolvedValue({
        enabled: true,
        items: [
          {
            id: 'audit-1',
            eventCode: 'workflow_pr_created',
            message: 'Workflow update PR created',
            actorUserId: 'user-1',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
        ],
      }),
    };
    const auditService = new ProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeProjectFeatureConfig({}),
      undefined,
      undefined,
      undefined,
      auditEventsService,
    );

    await expect(
      auditService.listProjectAuditEvents('project-1', 'user-1'),
    ).resolves.toEqual({
      enabled: true,
      items: [
        {
          id: 'audit-1',
          eventCode: 'workflow_pr_created',
          message: 'Workflow update PR created',
          actorUserId: 'user-1',
          createdAt: '2026-06-14T00:00:00.000Z',
        },
      ],
    });
    expect(projectsRepository.findByIdAndUser).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(auditEventsService.listProjectEvents).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
  });

  it('creates a local dashboard snapshot without calling live provider APIs', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    overviewRepos.ciTokensRepository.findProjectTokenStatus.mockResolvedValue(
      null,
    );
    overviewRepos.envVarsRepository.listEnvMetadata.mockResolvedValue([]);
    overviewRepos.dashboardSnapshotsRepository.createSnapshot.mockResolvedValue(
      {
        id: 'snapshot-warning',
        projectId: 'project-1',
        status: 'warning',
        summary: {
          mode: 'local_snapshot',
          projectId: 'project-1',
        },
        findings: [
          {
            code: 'ci_token_missing',
            severity: 'warning',
            message: 'No project CI token is tracked.',
            source: 'local_snapshot',
          },
        ],
        startedAt: '2026-06-12T00:00:00.000Z',
        completedAt: '2026-06-12T00:00:01.000Z',
        createdBy: 'user-1',
        createdAt: '2026-06-12T00:00:01.000Z',
      },
    );
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url:
          'https://github.com/tone/orders-api/commit/abc123456789',
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {
          workflowFiles: [
            {
              stage: 'access',
              name: 'FlowCI Access Gate',
              path: '.github/workflows/00-flowci-access.yml',
              gated: true,
            },
          ],
        },
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const githubWithLiveChecks = {
      ...makeGithubService(),
      repoExists: jest.fn(),
    };
    const auditEventsService = {
      recordProjectEvent: jest.fn(),
    };
    const notificationEventsService = {
      record: jest.fn(),
    };
    const OverviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const overviewService = new OverviewProjectsService(
      makeCatalogService(),
      githubWithLiveChecks,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ syncSnapshots: true }),
      undefined,
      undefined,
      undefined,
      auditEventsService,
      makeWorkspacesService(),
      notificationEventsService,
    ) as ProjectsService & {
      syncProjectSnapshot: (
        projectId: string,
        userId: string,
      ) => Promise<{
        snapshot: { status: string; findings: Array<{ code: string }> };
        overview: { syncSnapshot: { latest: unknown } };
      }>;
    };

    const result = await overviewService.syncProjectSnapshot(
      'project-1',
      'user-1',
    );

    expect(githubWithLiveChecks.repoExists).not.toHaveBeenCalled();
    expect(
      overviewRepos.dashboardSnapshotsRepository.createSnapshot,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        status: 'warning',
        createdBy: 'user-1',
        summary: expect.objectContaining({
          mode: 'local_snapshot',
          projectId: 'project-1',
          ciTokenStatus: 'missing',
          envVarCount: 0,
        }),
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'ci_token_missing' }),
          expect.objectContaining({ code: 'env_metadata_empty' }),
        ]),
      }),
    );
    expect(result.snapshot.status).toBe('warning');
    expect(result.overview.syncSnapshot.latest).toMatchObject({
      id: 'snapshot-warning',
    });
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: 'project-1',
        eventCode: 'project_snapshot_synced',
      }),
    );
    expect(notificationEventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        eventCode: 'project_snapshot_synced',
      }),
    );
  });

  it('maps existing project options into workflow settings when no settings row exists', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url:
          'https://github.com/tone/orders-api/commit/abc123456789',
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {
          servicePath: 'apps/api',
          nodeVersion: '22',
          coverageThreshold: 90,
          tests: { lint: true, security: true },
        },
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const PreviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const previewService = new PreviewProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ workflowSettingsPreview: true }),
      overviewRepos.workflowSettingsRepository,
    ) as ProjectsService & {
      getWorkflowSettings: (
        projectId: string,
        userId: string,
      ) => Promise<{
        source: string;
        settings: {
          servicePath: string;
          nodeVersion: string;
          coverageThreshold: number;
          packageManager: string;
        };
      }>;
    };

    const result = await previewService.getWorkflowSettings(
      'project-1',
      'user-1',
    );

    expect(
      overviewRepos.workflowSettingsRepository.findByProject,
    ).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      source: 'project_options',
      settings: {
        servicePath: 'apps/api',
        nodeVersion: '22',
        coverageThreshold: 90,
        packageManager: 'npm',
      },
    });
  });

  it('previews the three staged workflow files without writing to GitHub', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url:
          'https://github.com/tone/orders-api/commit/abc123456789',
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {
          workflowFiles: [
            {
              stage: 'access',
              name: 'FlowCI Access Gate',
              path: '.github/workflows/00-flowci-access.yml',
              gated: true,
            },
          ],
        },
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const githubWithWrites = {
      ...makeGithubService(),
      pushWorkflowFile: jest.fn(),
      createBranch: jest.fn(),
    };
    const PreviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const previewService = new PreviewProjectsService(
      makeCatalogService(),
      githubWithWrites,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ workflowSettingsPreview: true }),
      overviewRepos.workflowSettingsRepository,
    ) as ProjectsService & {
      previewWorkflowSettings: (
        projectId: string,
        userId: string,
        settings: Record<string, unknown>,
      ) => Promise<{
        workflowFiles: Array<{ path: string; yaml: string }>;
        diffSummary: Array<{ path: string; status: string }>;
        validationWarnings: unknown[];
      }>;
    };

    const result = await previewService.previewWorkflowSettings(
      'project-1',
      'user-1',
      { nodeVersion: '24', coverageThreshold: 85 },
    );

    expect(githubWithWrites.createBranch).not.toHaveBeenCalled();
    expect(githubWithWrites.pushWorkflowFile).not.toHaveBeenCalled();
    expect(result.workflowFiles.map((file) => file.path)).toEqual([
      '.github/workflows/00-flowci-access.yml',
      '.github/workflows/10-flowci-quality.yml',
      '.github/workflows/20-flowci-package.yml',
    ]);
    expect(result.workflowFiles[0]?.yaml).toContain('FlowCI Access Gate');
    expect(result.diffSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '.github/workflows/00-flowci-access.yml',
          status: 'changed',
        }),
        expect.objectContaining({
          path: '.github/workflows/10-flowci-quality.yml',
          status: 'new',
        }),
      ]),
    );
    expect(result.validationWarnings).toEqual([]);
  });

  it('returns a validation warning for an invalid coverage threshold preview', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url: null,
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {},
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const PreviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const previewService = new PreviewProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ workflowSettingsPreview: true }),
      overviewRepos.workflowSettingsRepository,
    ) as ProjectsService & {
      previewWorkflowSettings: (
        projectId: string,
        userId: string,
        settings: Record<string, unknown>,
      ) => Promise<{ workflowFiles: unknown[]; validationWarnings: unknown[] }>;
    };

    const result = await previewService.previewWorkflowSettings(
      'project-1',
      'user-1',
      { coverageThreshold: 150 },
    );

    expect(result.workflowFiles).toEqual([]);
    expect(result.validationWarnings).toEqual([
      expect.objectContaining({
        field: 'coverageThreshold',
        message: 'Coverage threshold must be between 0 and 100.',
      }),
    ]);
  });

  it('creates a workflow update branch, writes all staged files, creates a PR, and stores request metadata', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url: null,
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {
          workflowFiles: [
            {
              stage: 'access',
              name: 'FlowCI Access Gate',
              path: '.github/workflows/00-flowci-access.yml',
              gated: true,
            },
          ],
        },
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const githubWrites = makeGithubService() as unknown as GithubService & {
      createBranch: jest.Mock;
      putFileContent: jest.Mock;
      createPullRequest: jest.Mock;
    };
    const auditEventsService = {
      recordProjectEvent: jest.fn().mockResolvedValue(undefined),
    };
    const notificationEventsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const prService = new ProjectsService(
      makeCatalogService(),
      githubWrites,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({
        workflowSettingsPreview: true,
        workflowUpdatePr: true,
      }),
      overviewRepos.workflowSettingsRepository,
      overviewRepos.workflowUpdateRequestsRepository,
      undefined,
      auditEventsService,
      undefined,
      notificationEventsService,
    ) as ProjectsService & {
      createWorkflowUpdatePullRequest: (
        projectId: string,
        userId: string,
        oauthAccessToken: string | null,
        settings: Record<string, unknown>,
      ) => Promise<{
        branchName: string;
        pullRequestNumber: number;
        pullRequestUrl: string;
        workflowPath: string;
      }>;
    };

    const result = await prService.createWorkflowUpdatePullRequest(
      'project-1',
      'user-1',
      null,
      { nodeVersion: '24', coverageThreshold: 85 },
    );

    expect(githubWrites.createBranch).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'orders-api',
      expect.stringMatching(/^flowci\/workflow-update-\d{14}$/),
      'main',
    );
    expect(githubWrites.putFileContent).toHaveBeenCalledTimes(3);
    const putFileContentCalls = githubWrites.putFileContent.mock.calls as Array<
      [string, string, string, string, string, string, string]
    >;
    expect(putFileContentCalls.map((call) => call[3])).toEqual([
      '.github/workflows/00-flowci-access.yml',
      '.github/workflows/10-flowci-quality.yml',
      '.github/workflows/20-flowci-package.yml',
    ]);
    expect(githubWrites.createPullRequest).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'orders-api',
      expect.objectContaining({
        title: 'Update FlowCI workflow configuration',
        head: expect.stringMatching(/^flowci\/workflow-update-\d{14}$/),
        base: 'main',
        body: expect.stringContaining(
          'Runtime environment values are not included.',
        ),
      }),
    );
    expect(
      overviewRepos.workflowUpdateRequestsRepository.createRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        requestedBy: 'user-1',
        status: 'created',
        pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/tone/orders-api/pull/42',
      }),
    );
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      message: 'Workflow update PR created',
      metadata: expect.objectContaining({
        pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/tone/orders-api/pull/42',
        branchName: result.branchName,
        baseBranch: 'main',
      }),
    });
    expect(notificationEventsService.record).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      eventCode: 'workflow_pr_created',
      title: 'Workflow update PR created',
      body: expect.stringContaining('Workflow update PR #42'),
    });
    expect(result).toMatchObject({
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/tone/orders-api/pull/42',
      workflowPath: '.github/workflows/00-flowci-access.yml',
    });
  });

  it('creates workflow update PRs against the repository default branch', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url: null,
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {},
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const githubWrites = makeGithubService() as unknown as GithubService & {
      createBranch: jest.Mock;
      createPullRequest: jest.Mock;
      getRepo: jest.Mock;
    };
    githubWrites.getRepo.mockResolvedValueOnce({
      fullName: 'tone/orders-api',
      htmlUrl: 'https://github.com/tone/orders-api',
      defaultBranch: 'master',
      private: false,
    });
    const PrProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const prService = new PrProjectsService(
      makeCatalogService(),
      githubWrites,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({
        workflowSettingsPreview: true,
        workflowUpdatePr: true,
      }),
      overviewRepos.workflowSettingsRepository,
      overviewRepos.workflowUpdateRequestsRepository,
    );

    const result = await prService.createWorkflowUpdatePullRequest(
      'project-1',
      'user-1',
      null,
      {},
    );

    expect(githubWrites.createBranch).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'orders-api',
      result.branchName,
      'master',
    );
    expect(githubWrites.createPullRequest).toHaveBeenCalledWith(
      'app-token',
      'tone',
      'orders-api',
      expect.objectContaining({ base: 'master' }),
    );
  });

  it('returns a clean error when GitHub rejects workflow update PR creation', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const projectsRepository = {
      create: jest.fn(),
      findByIdAndUser: jest.fn().mockResolvedValue({
        id: 'project-1',
        user_id: 'user-1',
        repo_full_name: 'tone/orders-api',
        template_id: 'be-nestjs',
        service_name: 'orders-api',
        workflow_path: '.github/workflows/00-flowci-access.yml',
        status: 'provisioned',
        github_commit_sha: 'abc123456789',
        github_commit_url: null,
        failure_reason: null,
        repo_url: 'https://github.com/tone/orders-api',
        visibility: 'private',
        repo_shape: 'mono',
        project_type_id: 'nestjs-api',
        workflow_recipe_id: 'backend-api-ci',
        project_options: {},
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }),
    };
    const githubWrites = makeGithubService() as unknown as GithubService & {
      createPullRequest: jest.Mock;
    };
    githubWrites.createPullRequest.mockRejectedValueOnce(
      new Error('GitHub pull request creation failed (422): Validation Failed'),
    );
    const PrProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const prService = new PrProjectsService(
      makeCatalogService(),
      githubWrites,
      projectsRepository,
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({
        workflowSettingsPreview: true,
        workflowUpdatePr: true,
      }),
      overviewRepos.workflowSettingsRepository,
      overviewRepos.workflowUpdateRequestsRepository,
    ) as ProjectsService & {
      createWorkflowUpdatePullRequest: (
        projectId: string,
        userId: string,
        oauthAccessToken: string | null,
        settings: Record<string, unknown>,
      ) => Promise<unknown>;
    };

    await expect(
      prService.createWorkflowUpdatePullRequest(
        'project-1',
        'user-1',
        null,
        {},
      ),
    ).rejects.toThrow(
      'GitHub could not create the workflow update pull request.',
    );
  });

  it('throws not found when overview is requested for a project outside the user scope', async () => {
    const overviewRepos = makeOverviewReadRepositories();
    const OverviewProjectsService = ProjectsService as unknown as new (
      ...args: unknown[]
    ) => ProjectsService;
    const overviewService = new OverviewProjectsService(
      makeCatalogService(),
      githubService,
      { create: jest.fn(), findByIdAndUser: jest.fn().mockResolvedValue(null) },
      makeCiService(),
      projectDeploymentProvisioningService,
      overviewRepos.ciTokensRepository,
      overviewRepos.deploymentTargetsRepository,
      overviewRepos.envVarsRepository,
      overviewRepos.workflowHistoryRepository,
      overviewRepos.dashboardSnapshotsRepository,
      makeProjectFeatureConfig({ syncSnapshots: true }),
    ) as ProjectsService & {
      getProjectOverview: (
        projectId: string,
        userId: string,
      ) => Promise<unknown>;
    };

    await expect(
      overviewService.getProjectOverview('project-1', 'user-2'),
    ).rejects.toThrow('Project not found');
  });

  it('disconnects an owned project through the repository', async () => {
    const projectsRepository = {
      deleteByIdAndUser: jest.fn().mockResolvedValue(true),
    };
    const disconnectService = new ProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository as never,
      makeCiService(),
      projectDeploymentProvisioningService as never,
    );

    await expect(
      disconnectService.disconnectProject('project-1', 'user-1'),
    ).resolves.toBeUndefined();
    expect(projectsRepository.deleteByIdAndUser).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
  });

  it('throws not found when disconnecting a project outside the user scope', async () => {
    const disconnectService = new ProjectsService(
      makeCatalogService(),
      githubService,
      { deleteByIdAndUser: jest.fn().mockResolvedValue(false) } as never,
      makeCiService(),
      projectDeploymentProvisioningService as never,
    );

    await expect(
      disconnectService.disconnectProject('project-1', 'user-2'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns an empty sync summary when the user has no projects', async () => {
    const auditEventsService = {
      recordProjectEvent: jest.fn(),
    };
    const notificationEventsService = {
      record: jest.fn(),
    };
    const syncService = new ProjectsService(
      makeCatalogService(),
      githubService,
      { listByUser: jest.fn().mockResolvedValue([]) } as never,
      makeCiService(),
      projectDeploymentProvisioningService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auditEventsService as never,
      undefined,
      notificationEventsService as never,
    );

    await expect(
      syncService.syncProjects('user-1', 'gh-token'),
    ).resolves.toEqual({
      orphaned: 0,
      reachable: 0,
      total: 0,
    });
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: null,
        eventCode: 'project_sync_completed',
        metadata: { orphaned: 0, reachable: 0, total: 0 },
      }),
    );
    expect(notificationEventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: null,
        eventCode: 'project_sync_completed',
      }),
    );
  });

  it('marks unreachable projects orphaned and reachable projects active during sync', async () => {
    const syncGithubService = {
      ...makeGithubService(),
      repoExists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('transient')),
    } as unknown as GithubService;
    const projectsRepository = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 'project-1', repo_full_name: 'tone/orders-api' },
        { id: 'project-2', repo_full_name: 'tone/deleted-api' },
        { id: 'project-3', repo_full_name: 'tone/flaky-api' },
      ]),
      markOrphaned: jest.fn().mockResolvedValue(1),
      markReachable: jest.fn().mockResolvedValue(1),
    };
    const auditEventsService = {
      recordProjectEvent: jest.fn(),
    };
    const notificationEventsService = {
      record: jest.fn(),
    };
    const syncService = new ProjectsService(
      makeCatalogService(),
      syncGithubService,
      projectsRepository as never,
      makeCiService(),
      projectDeploymentProvisioningService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auditEventsService as never,
      undefined,
      notificationEventsService as never,
    );

    await expect(
      syncService.syncProjects('user-1', 'gh-token'),
    ).resolves.toEqual({
      orphaned: 1,
      reachable: 1,
      total: 3,
    });
    expect(projectsRepository.markReachable).toHaveBeenCalledWith(
      ['project-1'],
      'user-1',
    );
    expect(projectsRepository.markOrphaned).toHaveBeenCalledWith(
      ['project-2'],
      'user-1',
    );
    expect(auditEventsService.recordProjectEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        projectId: null,
        eventCode: 'project_sync_completed',
        metadata: { orphaned: 1, reachable: 1, total: 3 },
      }),
    );
    expect(notificationEventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: null,
        eventCode: 'project_sync_completed',
      }),
    );
  });

  it('builds workflow YAML with generated defaults and enhancement flags', async () => {
    const workflowService = service as unknown as {
      buildWorkflowYaml: (
        templateId: string,
        serviceName: string,
        servicePath?: string,
        nodeVersion?: string,
        coverageThreshold?: number,
        customOutputFileName?: string,
        enhancements?: Array<
          | 'strictProductionApproval'
          | 'enableUatApproval'
          | 'disablePlaywright'
          | 'disableK6'
        >,
      ) => Promise<{ generatedYaml: string; outputFileName: string }>;
    };

    mockedReadFile.mockResolvedValueOnce(`
name: CI
on:
  workflow_dispatch:
    inputs:
      service_name:
        type: string
jobs:
  pipeline:
    with: {}
`);

    const result = await workflowService.buildWorkflowYaml(
      'be-nestjs',
      'Orders API',
      'apps/api',
      '24',
      90,
      undefined,
      [
        'strictProductionApproval',
        'enableUatApproval',
        'disablePlaywright',
        'disableK6',
      ],
    );

    expect(result.outputFileName).toBe('orders-api-be-nestjs.yml');
    expect(result.generatedYaml).toContain('Orders API - Backend API');
    expect(result.generatedYaml).toContain('default: apps/api');
    expect(result.generatedYaml).toContain("default: '24'");
    expect(result.generatedYaml).toContain('default: 90');
    expect(result.generatedYaml).toContain('run-playwright: false');
    expect(result.generatedYaml).toContain('run-k6: false');
    expect(result.generatedYaml).toContain('require-uat-approval: true');
    expect(result.generatedYaml).toContain('require-production-approval: true');
  });

  it('throws when workflow YAML template cannot be parsed as an object', async () => {
    const workflowService = service as unknown as {
      buildWorkflowYaml: (
        templateId: string,
        serviceName: string,
      ) => Promise<{ generatedYaml: string; outputFileName: string }>;
    };
    mockedReadFile.mockResolvedValueOnce('- invalid');

    await expect(
      workflowService.buildWorkflowYaml('be-nestjs', 'Orders API'),
    ).rejects.toThrow('Workflow template could not be parsed');
  });
});
