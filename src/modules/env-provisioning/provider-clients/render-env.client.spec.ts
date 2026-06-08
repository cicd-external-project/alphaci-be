import { RenderEnvClient } from './render-env.client';

describe('RenderEnvClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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

  it('creates Render web services from repo metadata', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
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

    expect(target).toEqual({
      id: 'srv-1',
      name: 'api-service-test',
      provider: 'render',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.render.com/v1/services',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
