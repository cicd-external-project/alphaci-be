import { generateKeyPairSync } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config.js';
import { GithubService } from './github.service.js';
import type { GithubInstallationsRepository } from './github-installations.repository.js';

const makeRepo = (overrides = {}) => ({
  id: 1,
  name: 'my-repo',
  full_name: 'user/my-repo',
  private: false,
  description: 'A test repo',
  default_branch: 'main',
  html_url: 'https://github.com/user/my-repo',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const testPrivateKey = privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;

const appConfig: AppConfig = {
  frontendUrl: 'http://localhost:3000',
  github: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    callbackUrl: 'http://localhost:4000/api/v1/auth/github/callback',
    scope: 'read:user user:email',
    appId: '123456',
    appSlug: 'flowci-test',
    appPrivateKey: testPrivateKey,
    appWebhookSecret: 'webhook-secret',
  },
  templates: {
    repoPath: '../cicd-workflow',
    workflowDir: 'workflow-templates',
  },
  subscription: {
    mockEnabled: true,
    defaultPlan: 'free',
    seededPlans: {},
    proMonthlyPricePhp: 300,
  },
  supabase: {
    dbUrl: undefined,
  },
  session: {
    secret: 'x'.repeat(32),
    name: 'sid',
    maxAgeMs: 60_000,
    secure: false,
    storeDriver: 'memory',
  },
};

const makeConfigService = (config: AppConfig = appConfig) =>
  ({
    get: jest.fn().mockReturnValue(config),
  }) as unknown as ConfigService;

const makeInstallationsRepository = () =>
  ({
    upsert: jest.fn().mockResolvedValue({
      installationId: 12345,
      userId: 'user-1',
      accountLogin: 'tone',
      accountId: 99,
      repositorySelection: 'all',
      reposLinked: 2,
    }),
    replaceRepos: jest.fn().mockResolvedValue(undefined),
    findByUserId: jest.fn().mockResolvedValue([
      {
        installationId: 12345,
        userId: 'user-1',
        accountLogin: 'tone',
        accountId: 99,
        repositorySelection: 'all',
        reposLinked: 2,
      },
    ]),
    findReposByUserId: jest.fn().mockResolvedValue([]),
  }) as unknown as GithubInstallationsRepository;

describe('GithubService', () => {
  let service: GithubService;
  let installationsRepository: GithubInstallationsRepository;
  let fetchMock: jest.Mock;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    installationsRepository = makeInstallationsRepository();
    service = new GithubService(makeConfigService(), installationsRepository);
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('GitHub App tokens', () => {
    it('creates a signed app JWT with the configured app id', () => {
      const jwt = service.createAppJwt();
      const [, payloadPart] = jwt.split('.');
      expect(payloadPart).toBeDefined();

      const payload = JSON.parse(
        Buffer.from(payloadPart ?? '', 'base64url').toString('utf8'),
      ) as { iss: string; iat: number; exp: number };

      expect(payload.iss).toBe('123456');
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    });

    it('requests an installation access token with an app JWT', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'installation-token' }),
      } as unknown as Response);

      await expect(service.createInstallationAccessToken(12345)).resolves.toBe(
        'installation-token',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/12345/access_tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        }),
      );
    });
  });

  describe('linkInstallation', () => {
    it('fetches installation metadata, stores it, and syncs linked repos', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            account: { login: 'tone', id: 99 },
            repository_selection: 'all',
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'installation-token' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            repositories: [
              { full_name: 'tone/api' },
              { full_name: 'tone/web' },
            ],
          }),
        } as unknown as Response);

      const result = await service.linkInstallation('user-1', 12345);

      expect(installationsRepository.upsert).toHaveBeenCalledWith(
        'user-1',
        12345,
        'tone',
        99,
        'all',
        2,
      );
      expect(installationsRepository.replaceRepos).toHaveBeenCalledWith(12345, [
        'tone/api',
        'tone/web',
      ]);
      expect(result).toEqual({ reposLinked: 2, repositorySelection: 'all' });
    });
  });

  describe('getInstallationAccessTokenForUser', () => {
    it('returns an installation token for the first all-repositories installation', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'installation-token' }),
      } as unknown as Response);

      await expect(
        service.getInstallationAccessTokenForUser('user-1'),
      ).resolves.toBe('installation-token');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/12345/access_tokens',
        expect.any(Object),
      );
    });
  });

  describe('listRepos', () => {
    it('returns mapped repos on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo()],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com/user/repos'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
        }),
      );

      expect(result).toEqual([
        {
          id: 1,
          name: 'my-repo',
          fullName: 'user/my-repo',
          private: false,
          description: 'A test repo',
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/user/my-repo',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
    });

    it('returns empty array when response is not ok', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Unauthorized' }),
      } as unknown as Response);

      const result = await service.listRepos('bad-token');
      expect(result).toEqual([]);
    });

    it('maps null description correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo({ description: null })],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result[0]?.description).toBeNull();
    });

    it('maps private repos correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo({ private: true })],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result[0]?.private).toBe(true);
    });

    it('returns empty array for empty response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');
      expect(result).toEqual([]);
    });
  });
});
