import { Injectable } from '@nestjs/common';

import type {
  DeploymentStrategy,
  EnvOwnershipMode,
  EnvProvider,
  RenderDeployMethod,
} from './env-provisioning.types';

export type GcpDeploymentStrategy = 'gcp_cloud_run';

export interface ResolveLegacyDeploymentStrategyInput {
  provider: EnvProvider;
  ownershipMode: EnvOwnershipMode;
  action?: 'create' | 'register_existing';
  renderDeployMethod?: RenderDeployMethod | undefined;
}

export interface ResolveGcpDeploymentStrategyInput {
  provider: 'gcp';
  ownershipMode: EnvOwnershipMode;
}

export type ResolveDeploymentStrategyInput =
  | ResolveLegacyDeploymentStrategyInput
  | ResolveGcpDeploymentStrategyInput;

@Injectable()
export class DeploymentStrategyResolver {
  resolve(input: ResolveLegacyDeploymentStrategyInput): DeploymentStrategy;
  resolve(input: ResolveGcpDeploymentStrategyInput): GcpDeploymentStrategy;
  resolve(
    input: ResolveDeploymentStrategyInput,
  ): DeploymentStrategy | GcpDeploymentStrategy {
    if (input.provider === 'gcp') {
      return 'gcp_cloud_run';
    }

    if (input.provider === 'vercel') {
      return 'vercel_ci_pushed';
    }

    if (input.provider === 'render') {
      if (
        input.action === 'register_existing' ||
        input.renderDeployMethod === 'existing_service'
      ) {
        return 'render_existing_service';
      }

      if (input.ownershipMode === 'flowci_managed') {
        return 'render_image_pushed';
      }

      if (input.renderDeployMethod === 'byo_image') {
        return 'render_image_pushed';
      }

      return 'render_git_connected';
    }

    return 'provider_native';
  }
}
