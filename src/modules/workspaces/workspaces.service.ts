import { Injectable, NotFoundException } from '@nestjs/common';

import { WorkspaceAccessService } from './workspace-access.service';
import {
  WorkspacesRepository,
  type WorkspaceMemberSummary,
  type WorkspaceRole,
  type WorkspaceSummary,
} from './workspaces.repository';

export interface WorkspacesMeResponse {
  enabled: true;
  items: WorkspaceSummary[];
}

export interface AddWorkspaceMemberInput {
  loginOrEmail: string;
  role: WorkspaceRole;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly repository: WorkspacesRepository,
    private readonly workspaceAccessService: WorkspaceAccessService,
  ) {}

  async getMyWorkspaces(userId: string): Promise<WorkspacesMeResponse> {
    const existing = await this.repository.listForUser(userId);
    const items =
      existing.length > 0
        ? existing
        : [await this.repository.createPersonalWorkspace(userId)];

    return { enabled: true, items };
  }

  async listMembers(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberSummary[]> {
    await this.workspaceAccessService.assertWorkspaceRole(workspaceId, userId, [
      'admin',
      'delegated_lead',
      'member',
      'viewer',
    ]);
    return this.repository.listMembers(workspaceId);
  }

  async addMember(
    workspaceId: string,
    userId: string,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMemberSummary> {
    await this.workspaceAccessService.assertWorkspaceRole(workspaceId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const member = await this.repository.addMemberByLoginOrEmail(
      workspaceId,
      input.loginOrEmail,
      input.role,
    );
    if (!member) {
      throw new NotFoundException('User not found');
    }
    return member;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMemberSummary> {
    await this.workspaceAccessService.assertWorkspaceRole(workspaceId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const targetMembership = await this.repository.findMemberById(
      workspaceId,
      memberId,
    );
    if (!targetMembership) {
      throw new NotFoundException('Workspace member not found');
    }
    await this.workspaceAccessService.assertCanChangeOwnerRole(
      workspaceId,
      targetMembership,
      role,
    );
    const member = await this.repository.updateMemberRole(
      workspaceId,
      memberId,
      role,
    );
    if (!member) {
      throw new NotFoundException('Workspace member not found');
    }
    return member;
  }

  async removeMember(
    workspaceId: string,
    userId: string,
    memberId: string,
  ): Promise<{ id: string; removed: true }> {
    await this.workspaceAccessService.assertWorkspaceRole(workspaceId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const targetMembership = await this.repository.findMemberById(
      workspaceId,
      memberId,
    );
    if (!targetMembership) {
      throw new NotFoundException('Workspace member not found');
    }
    await this.workspaceAccessService.assertCanRemoveMember(
      workspaceId,
      targetMembership,
    );
    const removed = await this.repository.removeMember(workspaceId, memberId);
    if (!removed) {
      throw new NotFoundException('Workspace member not found');
    }
    return { id: removed.id, removed: true };
  }
}
