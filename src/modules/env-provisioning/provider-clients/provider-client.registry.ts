import { Injectable } from '@nestjs/common';

import type { EnvProvider } from '../env-provisioning.types';
import { RenderEnvClient } from './render-env.client';
import type { RuntimeEnvProviderClient } from './runtime-env-provider.client';
import { VercelEnvClient } from './vercel-env.client';

@Injectable()
export class ProviderClientRegistry {
  constructor(
    private readonly renderClient: RenderEnvClient,
    private readonly vercelClient: VercelEnvClient,
  ) {}

  getClient(provider: EnvProvider): RuntimeEnvProviderClient {
    if (provider === 'render') {
      return this.renderClient;
    }

    return this.vercelClient;
  }
}
