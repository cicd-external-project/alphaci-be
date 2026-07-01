export type GcpProvisioningJobType =
  | 'provision_target'
  | 'deploy_revision'
  | 'cleanup_preview'
  | 'reconcile_target'
  | 'delete_target';

export type GcpProvisioningJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'canceled';

export interface GcpProviderCapabilities {
  provider: 'gcp';
  enabled: boolean;
  disabledReason:
    | 'gcp_deployments_disabled'
    | 'missing_gcp_runtime_config'
    | null;
  deploymentStrategy: 'gcp_cloud_run';
  runtimeScopes: Array<'shared_project' | 'dedicated_customer_project'>;
  supportsPreviewDeployments: boolean;
  supportsCustomDomains: boolean;
  requiresProviderConnection: false;
  customerDatabaseManagedByAlphaCI: false;
  defaults: {
    projectId: string | null;
    region: string;
    artifactRegistryRepository: string | null;
  };
}

export interface DeploymentProviderCapabilities {
  gcp: GcpProviderCapabilities;
  legacyProviders: {
    vercel: {
      provider: 'vercel';
      enabledForNewTargets: boolean;
      requiresProviderConnection: false;
    };
    render: {
      provider: 'render';
      enabledForNewTargets: boolean;
      requiresProviderConnection: false;
    };
    byoDeploymentProviders: {
      enabledForNewConnections: boolean;
    };
  };
}

export interface ProvisioningJobSummary {
  id: string;
  jobType: GcpProvisioningJobType;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  deploymentTargetId: string | null;
  status: GcpProvisioningJobStatus;
  attemptCount: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  nextRetryAt: string | null;
  deadLetterReason: string | null;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProvisioningJobInput {
  jobType: GcpProvisioningJobType;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  deploymentTargetId?: string | null;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface SafeProvisioningError {
  code: string;
  safeMessage: string;
  nextRetryAt?: string | null;
}
