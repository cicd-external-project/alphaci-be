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
  envProvisioning: {
    enabled: false,
    encryptionKey: '',
    flowciManaged: {
      renderToken: '',
      renderOwnerId: null,
      vercelToken: '',
      vercelTeamId: null,
      vercelTeamSlug: null,
    },
  },
  gcpDeployments: {
    enabled: false,
    sharedProjectId: null,
    region: 'asia-southeast1',
    workloadIdentityProvider: null,
    deployerServiceAccount: null,
    artifactRegistryRepository: null,
    dedicatedProjectsEnabled: false,
    customDomainsEnabled: false,
    previewDeploymentsEnabled: false,
  },
  legacyProviders: {
    vercelEnabled: false,
    renderEnabled: false,
    byoDeploymentProviderEnabled: false,
  },
  projectSyncSnapshots: {
    enabled: false,
    liveGithubEnabled: false,
    liveProvidersEnabled: false,
  },
  workflowSettingsPreview: {
    enabled: false,
  },
  workflowUpdatePr: {
    enabled: false,
  },
  subscription: {
    gateEnabled: true,
    mockEnabled: true,
    defaultPlan: 'free',
    seededPlans: {},
    proMonthlyPricePhp: 300,
    paymentProvider: 'none',
    successUrl: 'http://localhost:3000/subscribe?status=success',
    cancelUrl: 'http://localhost:3000/subscribe?status=cancelled',
    paymongo: {
      secretKey: '',
      webhookSecret: '',
    },
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
  archivedAccountRetentionDays: 30,
  projectTargetManagement: { enabled: false },
  ciRunTracking: { enabled: false, liveGithubEnabled: false },
  deploymentHistory: { enabled: false, liveProvidersEnabled: false },
  driftDetection: { enabled: false },
  driftRepair: { enabled: false, liveRepairEnabled: false },
  driftLiveChecks: { enabled: false },
  usageQuotas: { enabled: false },
  workspaces: { enabled: false },
  auditEvents: { enabled: false },
  notifications: { enabled: false },
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
    it('builds the GitHub App install URL from config', () => {
      expect(service.getAppInstallUrl()).toBe(
        'https://github.com/apps/flowci-test/installations/new',
      );
    });

    it('throws when app credentials are missing for JWT creation', () => {
      const unconfigured = new GithubService(
        makeConfigService({
          ...appConfig,
          github: {
            ...appConfig.github,
            appId: '',
            appPrivateKey: '',
          },
        }),
        installationsRepository,
      );

      expect(() => unconfigured.createAppJwt()).toThrow(
        'GitHub App credentials are not configured',
      );
    });

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

    it('throws when installation token request fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      } as unknown as Response);

      await expect(
        service.createInstallationAccessToken(12345),
      ).rejects.toThrow(
        'GitHub installation token request failed (502): bad gateway',
      );
    });

    it('throws when installation token response has no token', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as unknown as Response);

      await expect(
        service.createInstallationAccessToken(12345),
      ).rejects.toThrow(
        'GitHub installation token response did not include a token',
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

    it('returns null when no GitHub App installation is linked', async () => {
      (installationsRepository.findByUserId as jest.Mock).mockResolvedValueOnce(
        [],
      );

      await expect(
        service.getInstallationAccessTokenForUser('user-1'),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null when the installation token exchange fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'github down',
      } as unknown as Response);

      await expect(
        service.getInstallationAccessTokenForUser('user-1'),
      ).resolves.toBeNull();
    });
  });

  describe('GitHub App installation repository reads', () => {
    it('returns linked repos from persistence', async () => {
      (
        installationsRepository.findReposByUserId as jest.Mock
      ).mockResolvedValueOnce([{ fullName: 'tone/orders-api' }]);

      await expect(service.listLinkedRepos('user-1')).resolves.toEqual([
        { fullName: 'tone/orders-api' },
      ]);
    });

    it('returns an empty repo list when persistence read fails', async () => {
      (
        installationsRepository.findReposByUserId as jest.Mock
      ).mockRejectedValueOnce(new Error('db down'));

      await expect(service.listLinkedRepos('user-1')).resolves.toEqual([]);
    });

    it('returns installation accounts from persistence', async () => {
      await expect(service.listInstallationAccounts('user-1')).resolves.toEqual(
        [expect.objectContaining({ installationId: 12345 })],
      );
    });

    it('returns an empty account list when persistence read fails', async () => {
      (installationsRepository.findByUserId as jest.Mock).mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(service.listInstallationAccounts('user-1')).resolves.toEqual(
        [],
      );
    });
  });

  describe('repoExists', () => {
    it.each([
      [200, true],
      [404, false],
      [403, false],
      [401, false],
    ])('maps GitHub status %s to %s', async (status, expected) => {
      fetchMock.mockResolvedValueOnce({
        status,
        text: async () => '',
      } as unknown as Response);

      await expect(
        service.repoExists('gh-token', 'tone/orders-api'),
      ).resolves.toBe(expected);
    });

    it('throws for unexpected GitHub repo lookup responses', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 503,
        text: async () => 'unavailable',
      } as unknown as Response);

      await expect(
        service.repoExists('gh-token', 'tone/orders-api'),
      ).rejects.toThrow(
        'GitHub repo existence check failed (503): unavailable',
      );
    });
  });

  describe('listRepos', () => {
    it('returns a mapped repository by owner and name', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => makeRepo({ default_branch: 'master' }),
      } as unknown as Response);

      await expect(
        service.getRepo('gh-token', 'user', 'my-repo'),
      ).resolves.toMatchObject({
        fullName: 'user/my-repo',
        defaultBranch: 'master',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/user/my-repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer gh-token',
          }),
        }),
      );
    });

    it('returns mapped repos on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeRepo()],
      } as unknown as Response);

      const result = await service.listRepos('gh-token');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com/user/repos'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer gh-token',
          }),
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

  describe('repository writes', () => {
    it('throws when getRepo receives a non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      } as unknown as Response);

      await expect(
        service.getRepo('gh-token', 'tone', 'missing'),
      ).rejects.toThrow('GitHub repo lookup failed (404): not found');
    });

    it('creates a repository through the GitHub API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/tone/orders-api',
          clone_url: 'https://github.com/tone/orders-api.git',
          owner: { login: 'tone' },
          name: 'orders-api',
        }),
      } as unknown as Response);

      await expect(
        service.createRepo('gh-token', {
          repoName: 'orders-api',
          description: 'Orders API',
          private: true,
        }),
      ).resolves.toEqual({
        repoUrl: 'https://github.com/tone/orders-api',
        cloneUrl: 'https://github.com/tone/orders-api.git',
        ownerLogin: 'tone',
        repoName: 'orders-api',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/user/repos',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'orders-api',
            description: 'Orders API',
            private: true,
            auto_init: true,
            default_branch: 'main',
          }),
        }),
      );
    });

    it('uses an empty description when creating a repository without one', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/tone/orders-api',
          clone_url: 'https://github.com/tone/orders-api.git',
          owner: { login: 'tone' },
          name: 'orders-api',
        }),
      } as unknown as Response);

      await service.createRepo('gh-token', {
        repoName: 'orders-api',
        private: false,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"description":""'),
        }),
      );
    });

    it.each([
      [403, 'GitHub rejected repo creation (403).'],
      [401, 'GitHub rejected repo creation (401).'],
      [422, 'Repository already exists or name is invalid:'],
      [500, 'GitHub repo creation failed (500):'],
    ])(
      'maps repo creation status %s to a useful exception',
      async (status, message) => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status,
          text: async () => 'failure body',
        } as unknown as Response);

        await expect(
          service.createRepo('gh-token', {
            repoName: 'orders-api',
            private: true,
          }),
        ).rejects.toThrow(message);
      },
    );

    it('creates a repository from a GitHub template repository', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/tone/orders-api',
          clone_url: 'https://github.com/tone/orders-api.git',
          owner: { login: 'tone' },
          name: 'orders-api',
        }),
      } as unknown as Response);

      await expect(
        service.createRepoFromTemplate('gh-token', {
          templateOwner: 'alphaexplora',
          templateRepo: 'nestjs-starter-kit',
          repoName: 'orders-api',
          private: true,
        }),
      ).resolves.toEqual({
        repoUrl: 'https://github.com/tone/orders-api',
        cloneUrl: 'https://github.com/tone/orders-api.git',
        ownerLogin: 'tone',
        repoName: 'orders-api',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/alphaexplora/nestjs-starter-kit/generate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'orders-api',
            private: true,
            include_all_branches: false,
          }),
        }),
      );
    });

    it.each([
      [403, 'GitHub rejected template repo creation (403).'],
      [401, 'GitHub rejected template repo creation (401).'],
      [422, 'Repository already exists or template is invalid:'],
      [500, 'GitHub template repo creation failed (500):'],
    ])(
      'maps template repository status %s to a useful exception',
      async (status, message) => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status,
          text: async () => 'failure body',
        } as unknown as Response);

        await expect(
          service.createRepoFromTemplate('gh-token', {
            templateOwner: 'alphaexplora',
            templateRepo: 'nestjs-starter-kit',
            repoName: 'orders-api',
            private: true,
          }),
        ).rejects.toThrow(message);
      },
    );

    it('creates a branch from an existing source branch ref', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ object: { sha: 'base-sha' } }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
        } as unknown as Response);

      await expect(
        service.createBranch('gh-token', 'tone', 'orders-api', 'test', 'main'),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://api.github.com/repos/tone/orders-api/git/refs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ref: 'refs/heads/test',
            sha: 'base-sha',
          }),
        }),
      );
    });

    it('throws when branch creation fails after source branch lookup', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ object: { sha: 'base-sha' } }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: async () => 'already exists',
        } as unknown as Response);

      await expect(
        service.createBranch('gh-token', 'tone', 'orders-api', 'test', 'main'),
      ).rejects.toThrow("Branch 'test' creation failed (422): already exists");
    });
  });

  describe('file and pull request operations', () => {
    it('returns null when a GitHub file is missing', async () => {
      fetchMock.mockResolvedValueOnce({ status: 404 } as unknown as Response);

      await expect(
        service.getFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'test',
        ),
      ).resolves.toBeNull();
    });

    it('decodes base64 GitHub file content', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          content: Buffer.from('name: CI').toString('base64'),
          encoding: 'base64',
        }),
      } as unknown as Response);

      await expect(
        service.getFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'test',
        ),
      ).resolves.toBe('name: CI');
    });

    it('returns null when GitHub content response is not base64 content', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ content: 'plain', encoding: 'utf-8' }),
      } as unknown as Response);

      await expect(
        service.getFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'test',
        ),
      ).resolves.toBeNull();
    });

    it('throws when GitHub file read fails', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        ok: false,
        text: async () => 'server error',
      } as unknown as Response);

      await expect(
        service.getFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'test',
        ),
      ).rejects.toThrow('GitHub file read failed (500): server error');
    });

    it('updates an existing GitHub file and returns commit metadata', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sha: 'existing-sha' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            commit: {
              sha: 'commit-sha',
              html_url: 'https://github.com/tone/orders-api/commit/commit-sha',
            },
          }),
        } as unknown as Response);

      await expect(
        service.putFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'name: CI',
          'test',
          'Update workflow',
        ),
      ).resolves.toEqual({
        commitSha: 'commit-sha',
        commitUrl: 'https://github.com/tone/orders-api/commit/commit-sha',
      });
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://api.github.com/repos/tone/orders-api/contents/ci.yml',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"sha":"existing-sha"'),
        }),
      );
    });

    it('creates a new GitHub file when no existing file is found', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: {
              html_url: 'https://github.com/tone/orders-api/blob/test/ci.yml',
            },
            commit: { sha: 'commit-sha' },
          }),
        } as unknown as Response);

      await expect(
        service.putFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'name: CI',
          'test',
          'Create workflow',
        ),
      ).resolves.toEqual({
        commitSha: 'commit-sha',
        commitUrl: 'https://github.com/tone/orders-api/blob/test/ci.yml',
      });
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.not.stringContaining('"sha"'),
        }),
      );
    });

    it('throws when existing file lookup fails before write', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'lookup failed',
      } as unknown as Response);

      await expect(
        service.putFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'name: CI',
          'test',
          'Update workflow',
        ),
      ).rejects.toThrow('GitHub file lookup failed (500): lookup failed');
    });

    it('throws when GitHub file write fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'write failed',
        } as unknown as Response);

      await expect(
        service.putFileContent(
          'gh-token',
          'tone',
          'orders-api',
          'ci.yml',
          'name: CI',
          'test',
          'Update workflow',
        ),
      ).rejects.toThrow('GitHub file write failed (500): write failed');
    });

    it('creates a pull request and maps the response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 42,
          html_url: 'https://github.com/tone/orders-api/pull/42',
        }),
      } as unknown as Response);

      await expect(
        service.createPullRequest('gh-token', 'tone', 'orders-api', {
          title: 'Update workflow',
          head: 'flowci/update',
          base: 'test',
        }),
      ).resolves.toEqual({
        number: 42,
        htmlUrl: 'https://github.com/tone/orders-api/pull/42',
      });
    });

    it('throws when pull request creation fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => 'validation failed',
      } as unknown as Response);

      await expect(
        service.createPullRequest('gh-token', 'tone', 'orders-api', {
          title: 'Update workflow',
          head: 'flowci/update',
          base: 'test',
        }),
      ).rejects.toThrow(
        'GitHub pull request creation failed (422): validation failed',
      );
    });

    it('throws when pull request response is incomplete', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 42 }),
      } as unknown as Response);

      await expect(
        service.createPullRequest('gh-token', 'tone', 'orders-api', {
          title: 'Update workflow',
          head: 'flowci/update',
          base: 'test',
        }),
      ).rejects.toThrow('GitHub pull request response was incomplete');
    });
  });

  describe('secrets and branch protection', () => {
    it('skips setting a secret when token is missing by default', async () => {
      await expect(
        service.setActionsSecret(
          null,
          'tone',
          'orders-api',
          'FLOWCI_TOKEN',
          'x',
        ),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when strict secret setting has no token', async () => {
      await expect(
        service.setActionsSecret(
          undefined,
          'tone',
          'orders-api',
          'FLOWCI_TOKEN',
          'x',
          {
            throwOnFailure: true,
          },
        ),
      ).rejects.toThrow('setActionsSecret: no token available');
    });

    it('returns without throwing when public key lookup fails in non-strict mode', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'missing',
      } as unknown as Response);

      await expect(
        service.setActionsSecret(
          'gh-token',
          'tone',
          'orders-api',
          'FLOWCI_TOKEN',
          'x',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws when public key lookup fails in strict mode', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'key failed',
      } as unknown as Response);

      await expect(
        service.setActionsSecretStrict(
          'gh-token',
          'tone',
          'orders-api',
          'FLOWCI_TOKEN',
          'x',
        ),
      ).rejects.toThrow('setActionsSecret: failed to fetch public key');
    });

    it('applies branch protection with the expected GitHub endpoint', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true } as unknown as Response);

      await expect(
        service.applyBranchProtection('gh-token', 'tone', 'orders-api', 'test'),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/tone/orders-api/branches/test/protection',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('does not throw when branch protection fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as unknown as Response);

      await expect(
        service.applyBranchProtection('gh-token', 'tone', 'orders-api', 'main'),
      ).resolves.toBeUndefined();
    });
  });
});
