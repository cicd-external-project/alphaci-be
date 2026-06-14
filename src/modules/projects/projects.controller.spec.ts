import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { ProjectsController } from './projects.controller.js';
import { ProjectCiRunsService } from './project-ci-runs.service.js';
import { ProjectDeploymentsService } from './project-deployments.service.js';
import { ProjectDriftRepairService } from './project-drift-repair.service.js';
import { ProjectDriftService } from './project-drift.service.js';
import { ProjectsService } from './projects.service.js';

const fakeUser = { id: 'user-1', login: 'testuser' };

const makeRequest = (
  user: typeof fakeUser | undefined = fakeUser,
  githubAccessToken?: string,
) =>
  ({
    session: {
      user,
      userId: user?.id,
      githubAccessToken,
    },
  }) as unknown as Request;

const makeUnauthRequest = () => ({ session: {} }) as unknown as Request;

const makeProjectsService = () =>
  ({
    createProject: jest.fn().mockResolvedValue({
      id: 'project-1',
      repoFullName: 'testuser/orders-api',
      repoUrl: 'https://github.com/testuser/orders-api',
      status: 'provisioned',
      workflowPath: '.github/workflows/ci.yml',
      githubCommitSha: 'commit-sha',
      githubCommitUrl: null,
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
    }),
    setupProject: jest.fn().mockResolvedValue({
      id: 'project-1',
      repoFullName: 'testuser/orders-api',
      status: 'provisioned',
      workflowPath: '.github/workflows/ci.yml',
      githubCommitSha: 'commit-sha',
      githubCommitUrl: null,
    }),
    listProjects: jest.fn().mockResolvedValue({ items: [] }),
    getProjectOverview: jest.fn().mockResolvedValue({
      project: { id: 'project-1', repoFullName: 'testuser/orders-api' },
      workflow: { files: [], stageCount: 0 },
      deploymentTargets: { items: [], count: 0 },
      environment: { items: [], count: 0 },
      ciAuth: { status: 'missing', tokenPresent: false },
      health: { summary: 'warning', checks: [] },
      capabilities: { envProvisioning: true },
    }),
    syncProjectSnapshot: jest.fn().mockResolvedValue({
      snapshot: {
        id: 'snapshot-1',
        projectId: 'project-1',
        status: 'warning',
      },
      overview: {
        project: { id: 'project-1', repoFullName: 'testuser/orders-api' },
        syncSnapshot: {
          enabled: true,
          mode: 'local_snapshot',
          latest: { id: 'snapshot-1', status: 'warning' },
        },
      },
    }),
    getWorkflowSettings: jest.fn().mockResolvedValue({
      enabled: true,
      source: 'project_options',
      settings: {
        projectId: 'project-1',
        templateId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'orders-api',
        servicePath: '.',
        nodeVersion: '24',
        packageManager: 'npm',
        coverageThreshold: 80,
      },
    }),
    previewWorkflowSettings: jest.fn().mockResolvedValue({
      settings: {
        projectId: 'project-1',
        nodeVersion: '24',
        coverageThreshold: 80,
      },
      workflowFiles: [
        {
          stage: 'access',
          name: 'FlowCI Access Gate',
          path: '.github/workflows/00-flowci-access.yml',
          gated: true,
          yaml: 'name: FlowCI Access Gate',
        },
      ],
      diffSummary: [
        { path: '.github/workflows/00-flowci-access.yml', status: 'changed' },
      ],
      validationWarnings: [],
    }),
    createWorkflowUpdatePullRequest: jest.fn().mockResolvedValue({
      projectId: 'project-1',
      repoFullName: 'testuser/orders-api',
      branchName: 'flowci/workflow-update-20260612000000',
      workflowPath: '.github/workflows/00-flowci-access.yml',
      workflowFiles: [
        {
          path: '.github/workflows/00-flowci-access.yml',
          stage: 'access',
          name: 'FlowCI Access Gate',
          gated: true,
        },
      ],
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/testuser/orders-api/pull/42',
      status: 'created',
    }),
    listProjectAuditEvents: jest.fn().mockResolvedValue({
      enabled: true,
      items: [],
    }),
  }) as unknown as ProjectsService;

const makeProjectCiRunsService = () =>
  ({
    listRuns: jest.fn().mockResolvedValue({
      enabled: true,
      mode: 'local_mock',
      liveGithubEnabled: false,
      githubActionsUrl: 'https://github.com/testuser/orders-api/actions',
      runs: [],
    }),
    getRun: jest.fn().mockResolvedValue({
      id: 'local-project-1-quality',
      stage: 'quality',
      workflowName: 'FlowCI Quality',
    }),
    rerun: jest.fn().mockResolvedValue({
      enabled: false,
      runId: 'local-project-1-quality',
      reason: 'Live GitHub run sync is not enabled',
    }),
  }) as unknown as ProjectCiRunsService;

const makeProjectDeploymentsService = () =>
  ({
    listDeployments: jest.fn().mockResolvedValue({
      enabled: true,
      mode: 'local_mock',
      liveProvidersEnabled: false,
      deployments: [],
    }),
  }) as unknown as ProjectDeploymentsService;

const makeProjectDriftService = () =>
  ({
    listFindings: jest.fn().mockResolvedValue({
      enabled: true,
      mode: 'local_snapshot',
      findings: [],
    }),
    runDetection: jest.fn().mockResolvedValue({
      enabled: true,
      mode: 'local_snapshot',
      findings: [],
    }),
  }) as unknown as ProjectDriftService;

const makeProjectDriftRepairService = () =>
  ({
    repair: jest.fn().mockResolvedValue({
      enabled: true,
      mode: 'local_safe',
      findingId: 'finding-1',
      action: 'mark_ignored',
      status: 'completed',
      message: 'Finding marked ignored',
    }),
  }) as unknown as ProjectDriftRepairService;

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: ProjectsService;
  let ciRunsService: ProjectCiRunsService;
  let deploymentsService: ProjectDeploymentsService;
  let driftService: ProjectDriftService;
  let driftRepairService: ProjectDriftRepairService;

  beforeEach(async () => {
    service = makeProjectsService();
    ciRunsService = makeProjectCiRunsService();
    deploymentsService = makeProjectDeploymentsService();
    driftService = makeProjectDriftService();
    driftRepairService = makeProjectDriftRepairService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: service },
        { provide: ProjectCiRunsService, useValue: ciRunsService },
        { provide: ProjectDeploymentsService, useValue: deploymentsService },
        { provide: ProjectDriftService, useValue: driftService },
        { provide: ProjectDriftRepairService, useValue: driftRepairService },
      ],
    })
      .overrideGuard(
        require('../../common/guards/session-auth.guard.js').SessionAuthGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        require('../../common/guards/subscription.guard.js').SubscriptionGuard,
      )
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ProjectsController);
  });

  it('creates a project with user id, login, and GitHub access token from session', async () => {
    const body = {
      repoName: 'orders-api',
      visibility: 'private' as const,
      projectTypeId: 'nestjs-api',
      workflowRecipeId: 'backend-api-ci',
      serviceName: 'orders-api',
    };

    const result = await controller.createProject(
      makeRequest(fakeUser, 'gh-token'),
      body,
    );

    expect(service.createProject).toHaveBeenCalledWith(
      'user-1',
      'testuser',
      'gh-token',
      body,
    );
    expect(result).toMatchObject({ repoFullName: 'testuser/orders-api' });
  });

  it('delegates project creation with null OAuth token so service can use GitHub App fallback', async () => {
    const body = {
      repoName: 'orders-api',
      visibility: 'private' as const,
      projectTypeId: 'nestjs-api',
      serviceName: 'orders-api',
    };

    await controller.createProject(makeRequest(fakeUser, undefined), body);

    expect(service.createProject).toHaveBeenCalledWith(
      'user-1',
      'testuser',
      null,
      body,
    );
  });

  it('passes the requested project list limit to the service', async () => {
    await controller.listProjects(makeRequest(), '25');

    expect(service.listProjects).toHaveBeenCalledWith('user-1', 25);
  });

  it('throws when listing projects without a session user', async () => {
    await expect(controller.listProjects(makeUnauthRequest())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns an overview for an owned project', async () => {
    const result = await (
      controller as unknown as {
        getProjectOverview: (req: Request, id: string) => Promise<unknown>;
      }
    ).getProjectOverview(makeRequest(), 'project-1');

    expect(service.getProjectOverview).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      project: { id: 'project-1', repoFullName: 'testuser/orders-api' },
    });
  });

  it('throws when requesting overview without a session user', async () => {
    await expect(
      (
        controller as unknown as {
          getProjectOverview: (req: Request, id: string) => Promise<unknown>;
        }
      ).getProjectOverview(makeUnauthRequest(), 'project-1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('runs local project snapshot sync without requiring a GitHub token', async () => {
    const result = await (
      controller as unknown as {
        syncProjectSnapshot: (req: Request, id: string) => Promise<unknown>;
      }
    ).syncProjectSnapshot(makeRequest(fakeUser, undefined), 'project-1');

    expect(service.syncProjectSnapshot).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      snapshot: { id: 'snapshot-1', status: 'warning' },
      overview: {
        syncSnapshot: {
          mode: 'local_snapshot',
        },
      },
    });
  });

  it('throws when running local project snapshot sync without a session user', async () => {
    await expect(
      (
        controller as unknown as {
          syncProjectSnapshot: (req: Request, id: string) => Promise<unknown>;
        }
      ).syncProjectSnapshot(makeUnauthRequest(), 'project-1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns workflow settings for an owned project', async () => {
    const result = await (
      controller as unknown as {
        getWorkflowSettings: (req: Request, id: string) => Promise<unknown>;
      }
    ).getWorkflowSettings(makeRequest(), 'project-1');

    expect(service.getWorkflowSettings).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      source: 'project_options',
      settings: { nodeVersion: '24', packageManager: 'npm' },
    });
  });

  it('previews workflow settings without requiring a GitHub token', async () => {
    const body = { nodeVersion: '22', coverageThreshold: 85 };

    const result = await (
      controller as unknown as {
        previewWorkflowSettings: (
          req: Request,
          id: string,
          body: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).previewWorkflowSettings(
      makeRequest(fakeUser, undefined),
      'project-1',
      body,
    );

    expect(service.previewWorkflowSettings).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      body,
    );
    expect(result).toMatchObject({
      workflowFiles: [
        expect.objectContaining({
          path: '.github/workflows/00-flowci-access.yml',
        }),
      ],
    });
  });

  it('creates a workflow update PR with the session GitHub token when available', async () => {
    const body = { nodeVersion: '22', coverageThreshold: 85 };

    const result = await (
      controller as unknown as {
        createWorkflowUpdatePullRequest: (
          req: Request,
          id: string,
          body: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).createWorkflowUpdatePullRequest(
      makeRequest(fakeUser, 'oauth-token'),
      'project-1',
      body,
    );

    expect(service.createWorkflowUpdatePullRequest).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      'oauth-token',
      body,
    );
    expect(result).toMatchObject({
      pullRequestUrl: 'https://github.com/testuser/orders-api/pull/42',
      status: 'created',
    });
  });

  it('lists local CI runs without requiring a GitHub token', async () => {
    const result = await controller.listCiRuns(
      makeRequest(fakeUser, undefined),
      'project-1',
    );

    expect(ciRunsService.listRuns).toHaveBeenCalledWith('project-1', 'user-1');
    expect(result).toMatchObject({
      mode: 'local_mock',
      liveGithubEnabled: false,
      runs: [],
    });
  });

  it('returns a local CI run detail', async () => {
    const result = await controller.getCiRun(
      makeRequest(),
      'project-1',
      'local-project-1-quality',
    );

    expect(ciRunsService.getRun).toHaveBeenCalledWith(
      'project-1',
      'local-project-1-quality',
      'user-1',
    );
    expect(result).toMatchObject({
      id: 'local-project-1-quality',
      stage: 'quality',
    });
  });

  it('returns disabled rerun state while live GitHub is off', async () => {
    const result = await controller.rerunCiRun(
      makeRequest(),
      'project-1',
      'local-project-1-quality',
    );

    expect(ciRunsService.rerun).toHaveBeenCalledWith(
      'project-1',
      'local-project-1-quality',
      'user-1',
    );
    expect(result).toMatchObject({
      enabled: false,
      reason: 'Live GitHub run sync is not enabled',
    });
  });

  it('lists local deployment history without requiring provider credentials', async () => {
    const result = await controller.listDeployments(
      makeRequest(fakeUser, undefined),
      'project-1',
    );

    expect(deploymentsService.listDeployments).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      mode: 'local_mock',
      liveProvidersEnabled: false,
      deployments: [],
    });
  });

  it('lists local drift findings without requiring provider credentials', async () => {
    const result = await controller.listDriftFindings(
      makeRequest(fakeUser, undefined),
      'project-1',
    );

    expect(driftService.listFindings).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      mode: 'local_snapshot',
      findings: [],
    });
  });

  it('runs local drift detection without requiring provider credentials', async () => {
    const result = await controller.runDriftDetection(
      makeRequest(fakeUser, undefined),
      'project-1',
    );

    expect(driftService.runDetection).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      mode: 'local_snapshot',
      findings: [],
    });
  });

  it('repairs a drift finding with an explicit local-safe action', async () => {
    const result = await controller.repairDriftFinding(
      makeRequest(fakeUser, 'oauth-token'),
      'project-1',
      'finding-1',
      { action: 'mark_ignored' },
    );

    expect(driftRepairService.repair).toHaveBeenCalledWith(
      'project-1',
      'finding-1',
      'user-1',
      'mark_ignored',
      'oauth-token',
    );
    expect(result).toMatchObject({
      mode: 'local_safe',
      status: 'completed',
    });
  });

  it('lists project audit events for an owned project', async () => {
    const result = await controller.listProjectAuditEvents(
      makeRequest(fakeUser),
      'project-1',
    );

    expect(service.listProjectAuditEvents).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(result).toMatchObject({
      enabled: true,
      items: [],
    });
  });
});
