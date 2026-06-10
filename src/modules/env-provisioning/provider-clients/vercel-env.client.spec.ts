import { VercelEnvClient } from './vercel-env.client';

const makeConfigService = (
  overrides: { teamId?: string | null; teamSlug?: string | null } = {},
) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        flowciManaged: {
          vercelTeamId: overrides.teamId ?? null,
          vercelTeamSlug: overrides.teamSlug ?? null,
        },
      },
    }),
  }) as never;

describe('VercelEnvClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Vercel env upsert for sensitive values', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const client = new VercelEnvClient();
    await client.upsertEnvironmentVariables({
      token: 'vercel',
      targetId: 'prj-1',
      environment: 'production',
      vars: [{ key: 'NEXT_PUBLIC_API_URL', value: 'https://api.example.com' }],
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/prj-1/env?upsert=true',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          key: 'NEXT_PUBLIC_API_URL',
          value: 'https://api.example.com',
          type: 'sensitive',
          target: ['production'],
        }),
      }),
    );
  });

  it('scopes env upserts to the configured Vercel team id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const client = new VercelEnvClient(
      makeConfigService({ teamId: 'team_flowci' }),
    );
    await client.upsertEnvironmentVariables({
      token: 'vercel',
      targetId: 'prj-1',
      environment: 'test',
      vars: [{ key: 'NEXT_PUBLIC_API_URL', value: 'https://api.example.com' }],
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/prj-1/env?upsert=true&teamId=team_flowci',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates Vercel projects from repo metadata', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient();
    const target = await client.createTarget({
      token: 'vercel',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      rootDirectory: 'apps/web',
      buildCommand: 'npm run build',
    });

    expect(target).toEqual({
      id: 'prj_1',
      name: 'web-app-test',
      provider: 'vercel',
      metadata: {
        deploymentStrategy: 'vercel_git_connected',
        gitConnected: true,
        vercelOrgId: 'vercel-account',
        vercelProjectId: 'prj_1',
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v11/projects',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('omits Git repository linking for CI-pushed Vercel projects', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient();
    const target = await client.createTarget({
      token: 'vercel',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      deploymentStrategy: 'vercel_ci_pushed',
      vercelOrgId: 'user_123',
    });

    const [, init] = (fetch as jest.Mock).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).not.toHaveProperty('gitRepository');
    expect(target.metadata).toEqual(
      expect.objectContaining({
        deploymentStrategy: 'vercel_ci_pushed',
        gitConnected: false,
        vercelOrgId: 'user_123',
      }),
    );
  });

  it('normalizes root directories before creating Vercel projects', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient();
    await client.createTarget({
      token: 'vercel',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      rootDirectory: './frontend',
    });

    const [, init] = (fetch as jest.Mock).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual(
      expect.objectContaining({
        rootDirectory: 'frontend',
      }),
    );
  });

  it('scopes project creation to the configured Vercel team slug when team id is absent', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient(
      makeConfigService({ teamSlug: 'flowci-team' }),
    );
    await client.createTarget({
      token: 'vercel',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      deploymentStrategy: 'vercel_git_connected',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v11/projects?slug=flowci-team',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes Vercel error response detail without exposing the token', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () =>
        Promise.resolve('{"error":{"message":"Missing team access"}}'),
    });

    const client = new VercelEnvClient();

    let thrown: Error | null = null;
    try {
      await client.createTarget({
        token: 'vercel-secret',
        repoFullName: 'owner/web-app',
        projectName: 'web-app-test',
        branchName: 'test',
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe(
      'Vercel project could not be created: 403 {"error":{"message":"Missing team access"}}',
    );
    expect(thrown?.message).not.toContain('vercel-secret');
  });

  it('returns an actionable message when Vercel GitHub integration is missing', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: 'bad_request',
              message:
                'To link a GitHub repository, you need to install the GitHub integration first.',
              action: 'Install GitHub App',
              link: 'https://github.com/apps/vercel',
              repo: 'cicd-external-project/test123',
            },
          }),
        ),
    });

    const client = new VercelEnvClient();

    await expect(
      client.createTarget({
        token: 'vercel-secret',
        repoFullName: 'cicd-external-project/test123',
        projectName: 'test123-frontend',
        branchName: 'test',
      }),
    ).rejects.toThrow(
      'Vercel GitHub integration is not installed or does not have access to cicd-external-project/test123. Install the Vercel GitHub App for that GitHub owner and grant repository access, then retry.',
    );
  });
});
