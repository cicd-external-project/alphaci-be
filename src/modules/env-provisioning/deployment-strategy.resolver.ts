import { Injectable } from '@nestjs/common';

import type {
  DeploymentStrategy,
  EnvOwnershipMode,
  EnvProvider,
} from './env-provisioning.types';

export interface ResolveDeploymentStrategyInput {
  provider: EnvProvider;
  ownershipMode: EnvOwnershipMode;
}

@Injectable()
export class DeploymentStrategyResolver {
  resolve(input: ResolveDeploymentStrategyInput): DeploymentStrategy {
    if (
      input.provider === 'vercel' &&
      input.ownershipMode === 'flowci_managed'
    ) {
      return 'vercel_git_connected';
    }

    if (input.provider === 'vercel' && input.ownershipMode === 'byo') {
      return 'vercel_ci_pushed';
    }

    return 'provider_native';
  }
}
