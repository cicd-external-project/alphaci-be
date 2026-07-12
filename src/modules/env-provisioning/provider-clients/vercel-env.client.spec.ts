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

  it('validates Vercel user access with fallback account metadata', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          user: {
            uid: 'user_1',
            username: 'tone',
          },
        }),
    });

    await expect(
      new VercelEnvClient().validateConnection('vercel'),
    ).resolves.toEqual({
      id: 'user_1',
      name: 'tone',
      metadata: {
        accountType: 'user',
        orgId: 'user_1',
      },
    });
  });

  it('uses fallback Vercel account metadata when the user payload is sparse', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(
      new VercelEnvClient().validateConnection('vercel'),
    ).resolves.toEqual({
      id: 'vercel-account',
      name: 'Vercel account',
      metadata: {
        accountType: 'user',
        orgId: 'vercel-account',
      },
    });
  });

  it('lists Vercel projects and filters incomplete rows', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          projects: [{ id: 'prj_1', name: 'orders-web' }, { id: 'prj_2' }],
        }),
    });

    await expect(new VercelEnvClient().listTargets('vercel')).resolves.toEqual([
      {
        id: 'prj_1',
        name: 'orders-web',
        provider: 'vercel',
      },
    ]);
  });

  it('deletes Vercel env vars by looking up the provider env id', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            envs: [{ id: 'env_1', key: 'DATABASE_URL' }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const client = new VercelEnvClient();
    await expect(
      client.deleteEnvironmentVariable({
        token: 'vercel',
        targetId: 'prj-1',
        environment: 'production',
        key: 'DATABASE_URL',
      }),
    ).resolves.toEqual({ key: 'DATABASE_URL', status: 'removed' });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.vercel.com/v9/projects/prj-1/env?key=DATABASE_URL&target=production',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer vercel',
        }) as unknown,
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.vercel.com/v9/projects/prj-1/env/env_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('treats missing Vercel env vars as already removed', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ envs: [] }),
    });

    await expect(
      new VercelEnvClient().deleteEnvironmentVariable({
        token: 'vercel',
        targetId: 'prj-1',
        environment: 'test',
        key: 'DATABASE_URL',
      }),
    ).resolves.toEqual({ key: 'DATABASE_URL', status: 'removed' });
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it('links Git repository metadata for CI-pushed Vercel projects', async () => {
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
    expect(JSON.parse(init.body)).toMatchObject({
      gitRepository: {
        type: 'github',
        repo: 'owner/web-app',
      },
    });
    expect(target.metadata).toEqual(
      expect.objectContaining({
        deploymentStrategy: 'vercel_ci_pushed',
        gitConnected: true,
        vercelOrgId: 'user_123',
      }),
    );
  });

  it('links Git repository metadata for ALPHACI-managed CI-pushed Vercel projects', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_managed',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient(
      makeConfigService({ teamId: 'team_flowci' }),
    );
    const target = await client.createTarget({
      token: 'flowci-vercel-token',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      deploymentStrategy: 'vercel_ci_pushed',
      vercelOrgId: 'team_flowci',
      vercelTeamId: 'team_flowci',
    });

    const [url, init] = (fetch as jest.Mock).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toBe('https://api.vercel.com/v11/projects?teamId=team_flowci');
    expect(JSON.parse(init.body)).toMatchObject({
      gitRepository: {
        type: 'github',
        repo: 'owner/web-app',
      },
    });
    expect(target.metadata).toEqual(
      expect.objectContaining({
        deploymentStrategy: 'vercel_ci_pushed',
        gitConnected: true,
        vercelOrgId: 'team_flowci',
        vercelTeamId: 'team_flowci',
      }),
    );
  });

  it('requires a Vercel org id for CI-pushed Vercel projects', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    const client = new VercelEnvClient();

    await expect(
      client.createTarget({
        token: 'vercel',
        repoFullName: 'owner/web-app',
        projectName: 'web-app-test',
        branchName: 'test',
        deploymentStrategy: 'vercel_ci_pushed',
      }),
    ).rejects.toThrow(
      'Vercel org id is required when creating CI-pushed deployment targets',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates Vercel team access', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'team_123',
          slug: 'flowci',
          name: 'ALPHACI',
        }),
    });

    const client = new VercelEnvClient();
    await expect(
      client.validateTeamAccess('vercel-token', 'team_123'),
    ).resolves.toEqual({
      id: 'team_123',
      slug: 'flowci',
      name: 'ALPHACI',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v2/teams/team_123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer vercel-token',
        }) as unknown,
      }),
    );
  });

  it('throws when Vercel team validation returns no id', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ slug: 'flowci' }),
    });

    await expect(
      new VercelEnvClient().validateTeamAccess('vercel-token', 'team_123'),
    ).rejects.toThrow('Vercel team validation returned an invalid response');
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

  it.each(['.', './', '/absolute', '../outside', 'apps/../api'])(
    'omits unsafe root directory %s',
    async (rootDirectory) => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'prj_1',
            name: 'web-app-test',
          }),
      });

      await new VercelEnvClient().createTarget({
        token: 'vercel',
        repoFullName: 'owner/web-app',
        projectName: 'web-app-test',
        branchName: 'test',
        rootDirectory,
      });

      const [, init] = (fetch as jest.Mock).mock.calls[0] as [
        string,
        { body: string },
      ];
      expect(JSON.parse(init.body)).not.toHaveProperty('rootDirectory');
    },
  );

  it('uses explicit Vercel team slug scope for project creation', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
        }),
    });

    await new VercelEnvClient().createTarget({
      token: 'vercel',
      repoFullName: 'owner/web-app',
      projectName: 'web-app-test',
      branchName: 'test',
      vercelTeamSlug: 'explicit-team',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v11/projects?slug=explicit-team',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when Vercel project creation response is invalid', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'prj_1' }),
    });

    await expect(
      new VercelEnvClient().createTarget({
        token: 'vercel',
        repoFullName: 'owner/web-app',
        projectName: 'web-app-test',
        branchName: 'test',
      }),
    ).rejects.toThrow('Vercel project creation returned an invalid response');
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

  it('reports the Vercel project exists with its latest deployment url', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'prj_1',
          name: 'web-app-test',
          latestDeployments: [{ url: 'web-app-test.vercel.app' }],
        }),
    });

    await expect(
      new VercelEnvClient().getTargetStatus({
        token: 'vercel',
        targetId: 'prj_1',
      }),
    ).resolves.toEqual({
      exists: true,
      url: 'web-app-test.vercel.app',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v9/projects/prj_1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer vercel',
        }) as unknown,
      }),
    );
  });

  it('reports the Vercel project does not exist on a 404', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    });

    await expect(
      new VercelEnvClient().getTargetStatus({
        token: 'vercel',
        targetId: 'prj_missing',
      }),
    ).resolves.toEqual({ exists: false });
  });

  it('deletes the Vercel project', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(
      new VercelEnvClient().deleteTarget({
        token: 'vercel',
        targetId: 'prj_1',
      }),
    ).resolves.toEqual({ deleted: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v9/projects/prj_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('treats an already-gone Vercel project (404) as deleted', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    });

    await expect(
      new VercelEnvClient().deleteTarget({
        token: 'vercel',
        targetId: 'prj_missing',
      }),
    ).resolves.toEqual({ deleted: true });
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
