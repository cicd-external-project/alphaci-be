import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { ProjectsController } from './projects.controller.js';
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
  }) as unknown as ProjectsService;

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: ProjectsService;

  beforeEach(async () => {
    service = makeProjectsService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: service }],
    })
      .overrideGuard(require('../../common/guards/session-auth.guard.js').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards/subscription.guard.js').SubscriptionGuard)
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

    const result = await controller.createProject(makeRequest(fakeUser, 'gh-token'), body);

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
});
