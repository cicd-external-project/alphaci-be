import type {
  EnvOwnershipMode,
  EnvProvider,
  EnvTargetSlot,
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
  environmentMap?: Record<string, unknown>;
}
