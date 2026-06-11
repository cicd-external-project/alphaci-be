import type {
  EnvOwnershipMode,
  EnvProvider,
  EnvTargetSlot,
  RenderDeployMethod,
  RenderEnvironmentName,
  RenderServiceType,
} from '../env-provisioning.types';

export interface CreateDeploymentTargetDto {
  action: 'create' | 'register_existing';
  slot: EnvTargetSlot;
  ownershipMode: EnvOwnershipMode;
  provider: EnvProvider;
  providerConnectionId?: string;
  providerProjectId?: string;
  providerProjectName?: string;
  projectName?: string;
  branchName?: string;
  rootDirectory?: string;
  buildCommand?: string;
  startCommand?: string;
  renderDeployMethod?: RenderDeployMethod;
  renderServiceType?: RenderServiceType;
  renderInstanceType?: string;
  renderRegion?: string;
  renderEnvironmentName?: RenderEnvironmentName;
  dockerContext?: string;
  dockerfilePath?: string;
  imageUrl?: string;
  environmentMap?: Record<string, unknown>;
}
