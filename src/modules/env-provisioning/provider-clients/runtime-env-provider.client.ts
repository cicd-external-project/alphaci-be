import type {
  DeploymentStrategy,
  EnvEnvironment,
  EnvProvider,
  EnvVarInput,
  RenderEnvironmentName,
  RenderRuntime,
  RenderServiceType,
} from '../env-provisioning.types';

export interface ProviderAccountSummary {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderDeploymentTarget {
  id: string;
  name: string;
  provider: EnvProvider;
  metadata?: Record<string, unknown>;
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
  deploymentStrategy?: DeploymentStrategy;
  renderServiceType?: RenderServiceType;
  renderRuntime?: RenderRuntime;
  renderInstanceType?: string;
  renderRegion?: string;
  renderEnvironmentName?: RenderEnvironmentName;
  dockerContext?: string;
  dockerfilePath?: string;
  imageUrl?: string;
  vercelOrgId?: string;
  vercelTeamId?: string;
  vercelTeamSlug?: string;
}

export interface UpsertProviderEnvInput {
  token: string;
  targetId: string;
  environment: EnvEnvironment;
  vars: EnvVarInput[];
}

export interface DeleteProviderEnvInput {
  token: string;
  targetId: string;
  environment: EnvEnvironment;
  key: string;
}

export interface ProviderTargetStatusInput {
  token: string;
  targetId: string;
}

export interface ProviderTargetStatus {
  exists: boolean;
  state?: string;
  url?: string | null;
}

export interface DeleteProviderTargetInput {
  token: string;
  targetId: string;
}

export interface DeleteProviderTargetResult {
  deleted: boolean;
}

export interface RuntimeEnvProviderClient {
  provider: EnvProvider;
  validateConnection(token: string): Promise<ProviderAccountSummary>;
  validateTeamAccess?(
    token: string,
    teamId: string,
  ): Promise<{ id: string; slug?: string; name?: string }>;
  listTargets(token: string): Promise<ProviderDeploymentTarget[]>;
  createTarget(
    input: CreateProviderTargetInput,
  ): Promise<ProviderDeploymentTarget>;
  upsertEnvironmentVariables(
    input: UpsertProviderEnvInput,
  ): Promise<ProviderProvisionResult>;
  deleteEnvironmentVariable(
    input: DeleteProviderEnvInput,
  ): Promise<{ key: string; status: 'removed' }>;
  getTargetStatus(
    input: ProviderTargetStatusInput,
  ): Promise<ProviderTargetStatus>;
  deleteTarget(
    input: DeleteProviderTargetInput,
  ): Promise<DeleteProviderTargetResult>;
}
