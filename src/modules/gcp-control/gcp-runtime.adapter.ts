export const GCP_RUNTIME_ADAPTER = Symbol('GCP_RUNTIME_ADAPTER');

export type GcpRuntimePlacement = 'shared' | 'dedicated';
export type GcpRuntimeEnvironment = 'dev' | 'uat' | 'prod' | 'preview';

export interface GcpRuntimeLabels {
  workspaceId: string;
  projectId: string;
  deploymentTargetId?: string;
  environment: GcpRuntimeEnvironment;
  tenantId?: string;
  correlationId?: string;
}

export interface EnsureProjectInput {
  workspaceId: string;
  projectId: string;
  gcpProjectId: string;
  runtimePlacement: GcpRuntimePlacement;
  region: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureProjectResult {
  gcpProjectId: string;
  region: string;
  resourceName: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureArtifactRegistryInput {
  gcpProjectId: string;
  region: string;
  repository: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureArtifactRegistryResult {
  gcpProjectId: string;
  region: string;
  resourceName: string;
  repository: string;
  repositoryUri: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureRuntimeServiceAccountInput {
  gcpProjectId: string;
  serviceName: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureRuntimeServiceAccountResult {
  gcpProjectId: string;
  resourceName: string;
  email: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureCloudRunServiceInput {
  gcpProjectId: string;
  region: string;
  serviceName: string;
  imageName: string;
  runtimeServiceAccountEmail: string;
  labels: GcpRuntimeLabels;
}

export interface EnsureCloudRunServiceResult {
  gcpProjectId: string;
  region: string;
  resourceName: string;
  serviceName: string;
  serviceUrl: string;
  revision: string;
  labels: GcpRuntimeLabels;
}

export interface GetCloudRunServiceInput {
  gcpProjectId: string;
  region: string;
  serviceName: string;
}

export interface GetCloudRunServiceResult {
  gcpProjectId: string;
  region: string;
  resourceName: string;
  serviceName: string;
  serviceUrl: string;
  revision: string;
}

export interface GcpRuntimeAdapter {
  ensureProject(input: EnsureProjectInput): Promise<EnsureProjectResult>;
  ensureArtifactRegistry(
    input: EnsureArtifactRegistryInput,
  ): Promise<EnsureArtifactRegistryResult>;
  ensureRuntimeServiceAccount(
    input: EnsureRuntimeServiceAccountInput,
  ): Promise<EnsureRuntimeServiceAccountResult>;
  ensureCloudRunService(
    input: EnsureCloudRunServiceInput,
  ): Promise<EnsureCloudRunServiceResult>;
  getCloudRunService(input: GetCloudRunServiceInput): Promise<GetCloudRunServiceResult>;
}

export class GcpRuntimeAdapterError extends Error {
  constructor(
    public readonly code: string,
    public readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'GcpRuntimeAdapterError';
  }
}
