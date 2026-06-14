import type { EnvProvider } from '../env-provisioning/env-provisioning.types';

export type DeploymentHistoryStatus =
  | 'queued'
  | 'building'
  | 'ready'
  | 'failed'
  | 'canceled'
  | 'unknown';

export interface ProjectDeploymentHistoryItem {
  id: string;
  targetId: string;
  targetName: string;
  provider: EnvProvider;
  environment: string | null;
  branch: string | null;
  commitSha: string | null;
  status: DeploymentHistoryStatus;
  createdAt: string;
  readyAt: string | null;
  providerUrl: string;
}
