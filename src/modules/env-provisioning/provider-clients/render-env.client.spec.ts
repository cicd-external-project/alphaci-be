import { RenderEnvClient } from './render-env.client';

describe('RenderEnvClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns owner metadata when validating Render connections', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            owner: {
              id: 'usr-owner-1',
              name: 'FlowCI Test',
            },
          },
        ]),
    });

    const account = await new RenderEnvClient().validateConnection('rnd_test');

    expect(account).toEqual({
      id: 'usr-owner-1',
      name: 'FlowCI Test',
      metadata: {
        ownerId: 'usr-owner-1',
        ownerName: 'FlowCI Test',
      },
    });
  });

  it('uses fallback owner metadata when Render validation response is sparse', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await expect(
      new RenderEnvClient().validateConnection('rnd_test'),
    ).resolves.toEqual({
      id: 'render-account',
      name: 'Render account',
      metadata: {
        ownerId: 'render-account',
        ownerName: 'Render account',
      },
    });
  });

  it('lists Render service targets and filters incomplete rows', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { service: { id: 'srv-1', name: 'orders-api' } },
          { service: { id: 'srv-2' } },
          {},
        ]),
    });

    await expect(new RenderEnvClient().listTargets('rnd')).resolves.toEqual([
      {
        id: 'srv-1',
        name: 'orders-api',
        provider: 'render',
      },
    ]);
  });

  it('merges env vars before Render replace update', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { envVar: { key: 'EXISTING', value: 'keep' } },
            { envVar: { key: 'DATABASE_URL', value: 'old' } },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const client = new RenderEnvClient();
    await client.upsertEnvironmentVariables({
      token: 'rnd',
      targetId: 'srv-1',
      environment: 'test',
      vars: [{ key: 'DATABASE_URL', value: 'new' }],
    });

    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.render.com/v1/services/srv-1/env-vars',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify([
          { key: 'EXISTING', value: 'keep' },
          { key: 'DATABASE_URL', value: 'new' },
        ]),
      }),
    );
  });

  it('deletes Render env vars by replacing the set without the key', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { envVar: { key: 'EXISTING', value: 'keep' } },
            { envVar: { key: 'DATABASE_URL', value: 'remove' } },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const client = new RenderEnvClient();
    await expect(
      client.deleteEnvironmentVariable({
        token: 'rnd',
        targetId: 'srv-1',
        environment: 'test',
        key: 'DATABASE_URL',
      }),
    ).resolves.toEqual({ key: 'DATABASE_URL', status: 'removed' });

    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.render.com/v1/services/srv-1/env-vars',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify([{ key: 'EXISTING', value: 'keep' }]),
      }),
    );
  });

  it('creates Render web services from repo metadata', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              owner: {
                id: 'tea-1',
                name: 'FlowCI workspace',
              },
            },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            service: {
              id: 'srv-1',
              name: 'api-service-test',
            },
          }),
      });

    const client = new RenderEnvClient();
    const target = await client.createTarget({
      token: 'rnd',
      repoFullName: 'owner/api-service',
      projectName: 'api-service-test',
      branchName: 'test',
      rootDirectory: '.',
      buildCommand: 'npm ci && npm run build',
      startCommand: 'npm run start:prod',
    });

    expect(target).toMatchObject({
      id: 'srv-1',
      name: 'api-service-test',
      provider: 'render',
      metadata: {
        deploymentStrategy: 'render_git_connected',
        renderServiceId: 'srv-1',
        renderServiceType: 'web_service',
        renderEnvironmentName: 'test',
        dockerContext: '.',
        dockerfilePath: 'Dockerfile',
      },
    });
    const [, request] = (fetch as jest.Mock).mock.calls[1] as [
      string,
      { body: string; method: string },
    ];
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      type: 'web_service',
      name: 'api-service-test',
      ownerId: 'tea-1',
      repo: 'https://github.com/owner/api-service',
      branch: 'test',
      rootDir: '.',
      buildCommand: 'npm ci && npm run build',
      startCommand: 'npm run start:prod',
      serviceDetails: {
        runtime: 'node',
        buildCommand: 'npm ci && npm run build',
        startCommand: 'npm run start:prod',
      },
    });
  });

  it('creates image-backed Render services with the bootstrap image', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          service: {
            id: 'srv-image',
            name: 'api-service-test',
          },
        }),
    });
    global.fetch = fetchMock;

    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: {
          flowciManaged: {
            renderOwnerId: 'tea-configured',
            renderBootstrapImage: 'ghcr.io/flowci/bootstrap:node-22',
            renderRegistryCredentialId: 'crd-1',
          },
        },
      }),
    };
    const client = new RenderEnvClient(configService as never);

    const target = await client.createTarget({
      token: 'rnd',
      repoFullName: 'owner/api-service',
      projectName: 'api-service-test',
      branchName: 'test',
      deploymentStrategy: 'render_image_pushed',
      renderInstanceType: 'free',
      renderRegion: 'singapore',
    });

    expect(target.metadata).toMatchObject({
      deploymentStrategy: 'render_image_pushed',
      bootstrapImage: 'ghcr.io/flowci/bootstrap:node-22',
      imageUrl: 'ghcr.io/flowci/bootstrap:node-22',
      renderInstanceType: 'free',
      renderRegion: 'singapore',
    });
    const [, request] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toMatchObject({
      type: 'web_service',
      name: 'api-service-test',
      ownerId: 'tea-configured',
      autoDeploy: 'no',
      image: {
        ownerId: 'tea-configured',
        imagePath: 'ghcr.io/flowci/bootstrap:node-22',
        registryCredentialId: 'crd-1',
      },
      serviceDetails: {
        runtime: 'image',
        plan: 'free',
        region: 'singapore',
      },
    });
  });

  it('uses configured FlowCI Render owner id when creating services', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          service: {
            id: 'srv-1',
            name: 'api-service-test',
          },
        }),
    });
    global.fetch = fetchMock;

    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: {
          flowciManaged: {
            renderOwnerId: 'tea-configured',
          },
        },
      }),
    };
    const client = new RenderEnvClient(configService as never);

    await client.createTarget({
      token: 'rnd',
      repoFullName: 'owner/api-service',
      projectName: 'api-service-test',
      branchName: 'test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    const body = JSON.parse(request.body) as { ownerId: string };
    expect(url).toBe('https://api.render.com/v1/services');
    expect(request.method).toBe('POST');
    expect(body.ownerId).toBe('tea-configured');
  });

  it('throws when Render owner lookup returns no owner id', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{}]),
    });

    await expect(
      new RenderEnvClient().createTarget({
        token: 'rnd',
        repoFullName: 'owner/api-service',
        projectName: 'api-service-test',
        branchName: 'test',
      }),
    ).rejects.toThrow('Render workspace lookup returned no owner id');
  });

  it('throws when Render service creation returns an invalid response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ owner: { id: 'tea-1' } }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ service: {} }),
      });

    await expect(
      new RenderEnvClient().createTarget({
        token: 'rnd',
        repoFullName: 'owner/api-service',
        projectName: 'api-service-test',
        branchName: 'main',
      }),
    ).rejects.toThrow('Render service creation returned an invalid response');
  });

  it('maps Render branches to environment names', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          service: {
            id: 'srv-1',
            name: 'api-service-test',
          },
        }),
    });

    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: {
          flowciManaged: {
            renderOwnerId: 'tea-configured',
          },
        },
      }),
    };
    const client = new RenderEnvClient(configService as never);

    await expect(
      client.createTarget({
        token: 'rnd',
        repoFullName: 'owner/api-service',
        projectName: 'api-service-test',
        branchName: 'main',
      }),
    ).resolves.toMatchObject({
      metadata: { renderEnvironmentName: 'production' },
    });
    await expect(
      client.createTarget({
        token: 'rnd',
        repoFullName: 'owner/api-service',
        projectName: 'api-service-test',
        branchName: 'uat',
      }),
    ).resolves.toMatchObject({
      metadata: { renderEnvironmentName: 'uat' },
    });
  });

  it.each([
    [402, 'Render billing is not configured'],
    [409, 'A Render service with this name already exists'],
    [401, 'Render API key is invalid'],
    [500, 'Render services could not be loaded: 500 server down'],
  ])(
    'maps Render error status %s to actionable errors',
    async (status, message) => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status,
        text: () => Promise.resolve(status === 500 ? 'server down' : ''),
      });

      await expect(new RenderEnvClient().listTargets('rnd')).rejects.toThrow(
        message,
      );
    },
  );
});
