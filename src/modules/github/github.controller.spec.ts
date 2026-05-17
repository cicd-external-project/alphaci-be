import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { GithubController } from './github.controller.js';
import { GithubService } from './github.service.js';
import type { Request } from 'express';

const fakeRepos = [
  {
    id: 1,
    name: 'my-repo',
    fullName: 'user/my-repo',
    private: false,
    description: null,
    defaultBranch: 'main',
    htmlUrl: 'https://github.com/user/my-repo',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const makeRequest = (githubToken?: string) =>
  ({ session: { githubAccessToken: githubToken } }) as unknown as Request;

const makeGithubService = () =>
  ({
    listRepos: jest.fn().mockResolvedValue(fakeRepos),
  }) as unknown as GithubService;

describe('GithubController', () => {
  let controller: GithubController;
  let service: GithubService;

  beforeEach(async () => {
    service = makeGithubService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GithubController],
      providers: [{ provide: GithubService, useValue: service }],
    })
      .overrideGuard(require('../../common/guards/session-auth.guard.js').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GithubController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('repos', () => {
    it('returns repos when access token is present', async () => {
      const req = makeRequest('gh-token-123');
      const result = await controller.repos(req);

      expect(service.listRepos).toHaveBeenCalledWith('gh-token-123');
      expect(result).toEqual({ repos: fakeRepos });
    });

    it('returns empty repos when no access token in session', async () => {
      const req = makeRequest(undefined);
      const result = await controller.repos(req);

      expect(service.listRepos).not.toHaveBeenCalled();
      expect(result).toEqual({ repos: [] });
    });
  });
});
