import { VercelEnvClient } from './vercel-env.client';

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
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v11/projects',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
