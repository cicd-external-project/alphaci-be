export type ProjectDriftSeverity = 'info' | 'warning' | 'error';
export type ProjectDriftStatus = 'active' | 'resolved' | 'ignored';
export type ProjectDriftSource = 'local_snapshot';

export interface ProjectDriftFinding {
  id: string;
  projectId: string;
  targetId: string | null;
  source: ProjectDriftSource;
  severity: ProjectDriftSeverity;
  code: string;
  message: string;
  details: Record<string, unknown>;
  status: ProjectDriftStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface ProjectDriftFindingInput {
  projectId: string;
  targetId?: string | null;
  source: ProjectDriftSource;
  severity: ProjectDriftSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ProjectDriftResponse {
  enabled: boolean;
  mode: 'local_snapshot';
  findings: ProjectDriftFinding[];
}

export type ProjectDriftRepairAction =
  | 'regenerate_workflow_preview'
  | 'create_workflow_update_pr'
  | 'rotate_ci_token'
  | 'detach_target'
  | 'mark_ignored';

export interface ProjectDriftRepairResponse {
  enabled: boolean;
  mode: 'local_safe';
  findingId: string;
  action: ProjectDriftRepairAction;
  status: 'completed' | 'disabled';
  message: string;
  result?: Record<string, unknown>;
}
