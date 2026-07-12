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
  // BYO Vercel connections carry their own team scope on the target's
  // providerMetadata rather than the deployment's managed-account default —
  // callers must pass it through so status/history/log lookups hit the
  // right team instead of silently falling back to the managed default (or
  // no scope at all).
  vercelTeamId?: string;
  vercelTeamSlug?: string;
}

export interface ProviderTargetStatus {
  exists: boolean;
  state?: string;
  url?: string | null;
  // Provider-specific fields discovered during the live status check (e.g.
  // Render's ownerId) that are worth persisting into providerMetadata so
  // later operations (like log fetching) don't need a separate lookup.
  metadata?: Record<string, unknown>;
}

export interface DeleteProviderTargetInput {
  token: string;
  targetId: string;
}

export interface DeleteProviderTargetResult {
  deleted: boolean;
}

export interface ProviderDeployEvent {
  id: string;
  status: string;
  createdAt: string;
  readyAt: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  trigger: string | null;
}

export interface ProviderLogEntry {
  timestamp: string;
  message: string;
  level: string;
}

export interface ProviderLogsInput extends ProviderTargetStatusInput {
  // 'build' vs 'app'/runtime — exact meaning is provider-specific; clients
  // ignore values they don't support rather than erroring.
  type?: string;
  startTime?: string;
  endTime?: string;
  // Render's log API requires the workspace owner id, which lives on the
  // target's providerMetadata (see deployment-targets.service.ts).
  renderOwnerId?: string;
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
  // Optional: not every client can list deploy/event history. Callers must
  // check for its presence before calling.
  getDeployHistory?(
    input: ProviderTargetStatusInput,
  ): Promise<ProviderDeployEvent[]>;
  // Optional: not every client can fetch runtime logs. Callers must check
  // for its presence before calling.
  getLogs?(input: ProviderLogsInput): Promise<ProviderLogEntry[]>;
}
