import type {
  EnvEnvironment,
  EnvProvider,
  EnvVarInput,
} from '../env-provisioning.types';

export interface ProviderAccountSummary {
  id: string;
  name: string;
}

export interface ProviderDeploymentTarget {
  id: string;
  name: string;
  provider: EnvProvider;
}

export interface ProviderProvisionResult {
  provisioned: Array<{ key: string; status: 'provisioned' }>;
  failed: Array<{ key: string; status: 'failed'; errorSummary: string }>;
}

export interface CreateProviderTargetInput {
  token: string;
  repoFullName: string;
  projectName: string;
  branchName: string;
  rootDirectory?: string;
  buildCommand?: string;
  startCommand?: string;
}

export interface UpsertProviderEnvInput {
  token: string;
  targetId: string;
  environment: EnvEnvironment;
  vars: EnvVarInput[];
}

export interface RuntimeEnvProviderClient {
  provider: EnvProvider;
  validateConnection(token: string): Promise<ProviderAccountSummary>;
  listTargets(token: string): Promise<ProviderDeploymentTarget[]>;
  createTarget(
    input: CreateProviderTargetInput,
  ): Promise<ProviderDeploymentTarget>;
  upsertEnvironmentVariables(
    input: UpsertProviderEnvInput,
  ): Promise<ProviderProvisionResult>;
}
