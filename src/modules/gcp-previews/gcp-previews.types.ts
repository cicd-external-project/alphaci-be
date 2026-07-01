export type PreviewPlanTier =
  | 'trial'
  | 'lower_shared'
  | 'production_business'
  | 'internal';
export type PreviewServiceSlot = 'web' | 'api' | 'worker';
export type PreviewLifecycleStatus =
  | 'requested'
  | 'building'
  | 'deploying'
  | 'healthy'
  | 'unhealthy'
  | 'expired'
  | 'cleanup_required'
  | 'deleting'
  | 'deleted'
  | 'failed';
export type PreviewCleanupStatus =
  | 'none'
  | 'pending'
  | 'cleanup_required'
  | 'deleting'
  | 'deleted'
  | 'failed';
export type PreviewCleanupReason =
  | 'pull_request_closed'
  | 'pull_request_merged'
  | 'ttl_expired'
  | 'inactive'
  | 'plan_downgraded'
  | 'manual_admin_cleanup';

export interface EvaluatePreviewCreationInput {
  planTier: PreviewPlanTier;
  activePreviewCount: number;
  forkPullRequest: boolean;
  usesProductionSecrets: boolean;
  productionSecretApproval?: boolean;
}

export interface PreviewCreationDecision {
  allowed: boolean;
  maxActivePreviews: number;
  reasons: string[];
}

export interface PlanPullRequestPreviewInput extends EvaluatePreviewCreationInput {
  workspaceId: string;
  projectId: string;
  deploymentTargetId: string;
  customerSlug: string;
  appSlug: string;
  serviceSlot: PreviewServiceSlot;
  repositoryFullName: string;
  pullRequestNumber: number;
  sourceBranch: string;
  commitSha: string;
  managedDomainBase: string;
  sharedProjectId: string;
  artifactRegistryRepository: string;
  region: string;
}

export interface PlannedPreviewTarget {
  previewId: string;
  workspaceId: string;
  projectId: string;
  deploymentTargetId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
  sourceBranchHash: string;
  commitSha: string;
  cloudRunServiceName: string;
  previewDomain: string;
  previewUrl: string;
  lifecycleStatus: PreviewLifecycleStatus;
  cleanupStatus: PreviewCleanupStatus;
  expiresAt: string;
  labels: Record<string, string>;
  provisioningJobId: string;
  provisioningStatus: string;
}

export interface PlanPreviewCleanupInput {
  previewId: string;
  cloudRunServiceName: string;
  previewDomain: string;
  imageTags: string[];
  secretVersionNames: string[];
  labels: Record<string, string | undefined>;
  reason: PreviewCleanupReason;
}

export interface PreviewCleanupPlan {
  previewId: string;
  cleanupStatus: 'cleanup_required';
  reason: PreviewCleanupReason;
  liveMutationAllowed: false;
  resourcesToDelete: {
    cloudRunServices: string[];
    domainRecords: string[];
    imageTags: string[];
    secretVersions: string[];
  };
}

export interface PreviewCleanupCandidate {
  previewId: string;
  lifecycleStatus: PreviewLifecycleStatus;
  cleanupStatus: PreviewCleanupStatus;
  expiresAt: string;
}
