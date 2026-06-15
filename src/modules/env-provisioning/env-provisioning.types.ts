export type EnvProvider = 'render' | 'vercel';
export type EnvEnvironment = 'test' | 'uat' | 'production';
export type EnvOwnershipMode = 'byo' | 'flowci_managed';
export type EnvTargetSlot = 'backend' | 'frontend' | 'standalone';
export type RenderDeploymentStrategy =
  | 'render_git_connected'
  | 'render_image_pushed'
  | 'render_existing_service';
export type VercelDeploymentStrategy =
  | 'vercel_git_connected'
  | 'vercel_ci_pushed';
export type DeploymentStrategy =
  | 'provider_native'
  | VercelDeploymentStrategy
  | RenderDeploymentStrategy;
export type RenderServiceType =
  | 'web_service'
  | 'private_service'
  | 'background_worker'
  | 'cron_job';
export type RenderDeployMethod =
  | 'managed_image'
  | 'byo_image'
  | 'native_git'
  | 'existing_service';
export type RenderEnvironmentName = EnvEnvironment;
export type ProviderConnectionStatus = 'active' | 'revoked' | 'failed';
export type DeploymentTargetStatus = 'active' | 'missing' | 'failed';
export type EnvVarProvisionStatus = 'provisioned' | 'failed';

export interface EnvVarInput {
  key: string;
  value: string;
}

export interface ProviderConnectionSummary {
  id: string;
  provider: EnvProvider;
  label: string;
  tokenLastFour: string;
  status: ProviderConnectionStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface ProviderConnectionWithToken extends ProviderConnectionSummary {
  encryptedToken: string;
}

export interface DeploymentTargetSummary {
  id: string;
  projectId: string;
  slot: EnvTargetSlot;
  ownershipMode: EnvOwnershipMode;
  provider: EnvProvider;
  providerConnectionId: string | null;
  providerProjectId: string;
  providerProjectName: string;
  repoFullName: string;
  branchName: string;
  rootDirectory: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  renderServiceType?: RenderServiceType | null;
  renderInstanceType?: string | null;
  renderRegion?: string | null;
  renderEnvironmentName?: RenderEnvironmentName | null;
  dockerContext?: string | null;
  dockerfilePath?: string | null;
  imageUrl?: string | null;
  environmentMap: Record<string, unknown>;
  deploymentStrategy: DeploymentStrategy;
  providerMetadata: Record<string, unknown>;
  status: DeploymentTargetStatus;
}

export interface EnvVarMetadata {
  id: string;
  projectId: string;
  deploymentTargetId: string;
  environment: EnvEnvironment;
  key: string;
  provider: EnvProvider;
  valueStored: false;
  lastProvisionedAt: string;
  lastProvisionedBy: string;
  status: EnvVarProvisionStatus;
  errorSummary: string | null;
  removedAt?: string | null;
}
