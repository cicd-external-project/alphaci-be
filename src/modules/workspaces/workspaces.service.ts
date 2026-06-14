import { Injectable } from '@nestjs/common';

import { WorkspacesRepository, type WorkspaceSummary } from './workspaces.repository';

export interface WorkspacesMeResponse {
  enabled: true;
  items: WorkspaceSummary[];
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly repository: WorkspacesRepository) {}

  async getMyWorkspaces(userId: string): Promise<WorkspacesMeResponse> {
    const existing = await this.repository.listForUser(userId);
    const items =
      existing.length > 0
        ? existing
        : [await this.repository.createPersonalWorkspace(userId)];

    return { enabled: true, items };
  }
}
