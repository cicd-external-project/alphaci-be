export type GcpRuntimeOwnerType = 'alphaexplora_product' | 'alphaci_customer';
export type GcpRuntimeScope = 'shared_project' | 'dedicated_customer_project';
export type GcpRuntimeEnvironment = 'dev' | 'stg' | 'uat' | 'prod' | 'preview';
export type GcpRuntimeServiceSlot = 'web' | 'api' | 'worker' | 'standalone';
export type GcpProvisioningStatus =
  | 'pending'
  | 'provisioning'
  | 'provisioned'
  | 'failed'
  | 'deleting'
  | 'deleted';
export type GcpDeploymentStatus =
  | 'idle'
  | 'queued'
  | 'deploying'
  | 'healthy'
  | 'unhealthy'
  | 'failed'
  | 'rolled_back';

export interface GcpDeploymentTargetSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  ownerType: GcpRuntimeOwnerType;
  runtimeScope: GcpRuntimeScope;
  productSlug: string | null;
  customerSlug: string;
  appSlug: string;
  environment: GcpRuntimeEnvironment;
  serviceSlot: GcpRuntimeServiceSlot;
  provider: 'gcp';
  deploymentStrategy: 'gcp_cloud_run';
  gcpProjectId: string;
  gcpProjectNumber: string | null;
  region: string;
  artifactRegistryLocation: string;
  artifactRegistryRepo: string;
  imageName: string;
  cloudRunServiceName: string;
  runtimeServiceAccount: string;
  deployerServiceAccount: string;
  provisioningStatus: GcpProvisioningStatus;
  deploymentStatus: GcpDeploymentStatus;
  lastHealthyRevision: string | null;
  lastDeploymentErrorCode: string | null;
  lastDeploymentErrorSafeMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGcpDeploymentTargetInput {
  workspaceId: string;
  projectId: string;
  ownerType: GcpRuntimeOwnerType;
  runtimeScope: GcpRuntimeScope;
  productSlug?: string | null;
  customerSlug: string;
  appSlug: string;
  environment: GcpRuntimeEnvironment;
  serviceSlot: GcpRuntimeServiceSlot;
  gcpProjectId: string;
  gcpProjectNumber?: string | null;
  region: string;
  artifactRegistryLocation: string;
  artifactRegistryRepo: string;
  imageName: string;
  cloudRunServiceName: string;
  runtimeServiceAccount: string;
  deployerServiceAccount: string;
  metadata?: Record<string, unknown>;
}

export interface FindGcpDeploymentTargetInput {
  workspaceId: string;
  projectId: string;
  environment: GcpRuntimeEnvironment;
  serviceSlot: GcpRuntimeServiceSlot;
}
