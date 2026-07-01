import {
  GcpRuntimeAdapterError,
  type EnsureArtifactRegistryInput,
  type EnsureArtifactRegistryResult,
  type EnsureCloudRunServiceInput,
  type EnsureCloudRunServiceResult,
  type EnsureProjectInput,
  type EnsureProjectResult,
  type EnsureRuntimeServiceAccountInput,
  type EnsureRuntimeServiceAccountResult,
  type GcpRuntimeAdapter,
  type GetCloudRunServiceInput,
  type GetCloudRunServiceResult,
} from './gcp-runtime.adapter';

export type FakeGcpRuntimeOperation =
  | 'ensureProject'
  | 'ensureArtifactRegistry'
  | 'ensureRuntimeServiceAccount'
  | 'ensureCloudRunService'
  | 'getCloudRunService';

export interface FakeGcpRuntimeAdapterOptions {
  failOperation?: FakeGcpRuntimeOperation;
  errorCode?: string;
  safeMessage?: string;
}

export interface FakeGcpRuntimeCall {
  operation: FakeGcpRuntimeOperation;
  input: unknown;
}

export class FakeGcpRuntimeAdapter implements GcpRuntimeAdapter {
  readonly calls: FakeGcpRuntimeCall[] = [];

  constructor(private readonly options: FakeGcpRuntimeAdapterOptions = {}) {}

  async ensureProject(input: EnsureProjectInput): Promise<EnsureProjectResult> {
    this.record('ensureProject', input);
    return {
      gcpProjectId: input.gcpProjectId,
      region: input.region,
      resourceName: `projects/${input.gcpProjectId}`,
      labels: input.labels,
    };
  }

  async ensureArtifactRegistry(
    input: EnsureArtifactRegistryInput,
  ): Promise<EnsureArtifactRegistryResult> {
    this.record('ensureArtifactRegistry', input);
    return {
      gcpProjectId: input.gcpProjectId,
      region: input.region,
      resourceName: `projects/${input.gcpProjectId}/locations/${input.region}/repositories/${input.repository}`,
      repository: input.repository,
      repositoryUri: `${input.region}-docker.pkg.dev/${input.gcpProjectId}/${input.repository}`,
      labels: input.labels,
    };
  }

  async ensureRuntimeServiceAccount(
    input: EnsureRuntimeServiceAccountInput,
  ): Promise<EnsureRuntimeServiceAccountResult> {
    this.record('ensureRuntimeServiceAccount', input);
    return {
      gcpProjectId: input.gcpProjectId,
      resourceName: `projects/${input.gcpProjectId}/serviceAccounts/${input.serviceName}@${input.gcpProjectId}.iam.gserviceaccount.com`,
      email: `${input.serviceName}@${input.gcpProjectId}.iam.gserviceaccount.com`,
      labels: input.labels,
    };
  }

  async ensureCloudRunService(
    input: EnsureCloudRunServiceInput,
  ): Promise<EnsureCloudRunServiceResult> {
    this.record('ensureCloudRunService', input);
    return {
      gcpProjectId: input.gcpProjectId,
      region: input.region,
      resourceName: `projects/${input.gcpProjectId}/locations/${input.region}/services/${input.serviceName}`,
      serviceName: input.serviceName,
      serviceUrl: `https://${input.serviceName}-uc.a.run.app`,
      revision: `${input.serviceName}-00001-fake`,
      labels: input.labels,
    };
  }

  async getCloudRunService(
    input: GetCloudRunServiceInput,
  ): Promise<GetCloudRunServiceResult> {
    this.record('getCloudRunService', input);
    return {
      gcpProjectId: input.gcpProjectId,
      region: input.region,
      resourceName: `projects/${input.gcpProjectId}/locations/${input.region}/services/${input.serviceName}`,
      serviceName: input.serviceName,
      serviceUrl: `https://${input.serviceName}-uc.a.run.app`,
      revision: `${input.serviceName}-00001-fake`,
    };
  }

  private record(operation: FakeGcpRuntimeOperation, input: unknown): void {
    if (this.options.failOperation === operation) {
      throw new GcpRuntimeAdapterError(
        this.options.errorCode ?? 'GCP_RUNTIME_OPERATION_FAILED',
        this.options.safeMessage ?? 'GCP runtime operation failed',
      );
    }

    this.calls.push({ operation, input });
  }
}
