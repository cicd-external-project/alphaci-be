import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditEventsService } from '../../audit/audit-events.service';
import { AssignmentsRepository } from '../assignments/assignments.repository';
import { GithubSyncService } from '../github-sync/github-sync.service';
import { HierarchyAccessService } from '../hierarchy-access.service';
import { HIERARCHY_EVENT_CODES } from '../hierarchy.types';
import {
  GroupsRepository,
  type GroupMemberRecord,
  type GroupRecord,
} from './groups.repository';
import type { UpdateGroupDto } from '../dto/update-group.dto';
import type { UpdateMemberRoleDto } from '../dto/update-member-role.dto';

@Injectable()
export class GroupsService {
  constructor(
    private readonly groupsRepository: GroupsRepository,
    private readonly accessService: HierarchyAccessService,
    private readonly assignmentsRepository: AssignmentsRepository,
    private readonly githubSyncService: GithubSyncService,
    private readonly auditEventsService: AuditEventsService,
  ) {}

  async createGroup(
    userId: string,
    input: { name: string; description?: string; businessUnit?: string },
  ): Promise<GroupRecord> {
    const group = await this.groupsRepository.createGroup({
      name: input.name,
      description: input.description ?? null,
      businessUnit: input.businessUnit ?? null,
      creatorUserId: userId,
    });

    await this.auditEventsService.recordProjectEvent({
      workspaceId: group.id,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.groupCreated,
      message: `Group "${group.name}" created`,
      metadata: { groupId: group.id },
    });

    return { ...group, role: 'admin' };
  }

  async getMyGroups(userId: string): Promise<GroupRecord[]> {
    return this.groupsRepository.listForUser(userId);
  }

  async getGroup(groupId: string, userId: string): Promise<GroupRecord> {
    const membership = await this.accessService.assertGroupMembership(
      groupId,
      userId,
    );
    const group = await this.groupsRepository.findGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    return { ...group, role: membership.role };
  }

  async updateGroup(
    groupId: string,
    userId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupRecord> {
    await this.accessService.assertGroupRole(groupId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const group = await this.groupsRepository.updateGroup(groupId, dto);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.groupUpdated,
      message: `Group "${group.name}" updated`,
      metadata: { groupId, changes: dto },
    });

    return group;
  }

  async archiveGroup(groupId: string, userId: string): Promise<GroupRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(
      groupId,
      userId,
      ['admin'],
    );
    const group = await this.groupsRepository.setArchiveStatus(
      groupId,
      'archived',
      userId,
    );
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.groupArchived,
      message: `Group "${group.name}" archived`,
      metadata: { groupId },
    });

    return group;
  }

  async reopenGroup(groupId: string, userId: string): Promise<GroupRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(
      groupId,
      userId,
      ['admin'],
    );
    const group = await this.groupsRepository.setArchiveStatus(
      groupId,
      'active',
      userId,
    );
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.groupReopened,
      message: `Group "${group.name}" reopened`,
      metadata: { groupId },
    });

    return group;
  }

  /**
   * Platform-admin-only (enforced by PlatformAdminGuard at the controller).
   * Promotes newManagerUserId to owner, demotes every other current owner to
   * admin — a Group can never lose its final active manager (source plan
   * §4.4/§11).
   */
  async transferManager(
    groupId: string,
    actingUserId: string,
    newManagerUserId: string,
  ): Promise<GroupRecord> {
    const group = await this.groupsRepository.findGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    const target = await this.groupsRepository.findActiveMembership(
      groupId,
      newManagerUserId,
    );
    if (!target) {
      throw new BadRequestException(
        'The new manager must already be an active member of the Group',
      );
    }

    const previousRole = target.role;
    await this.groupsRepository.updateMemberRole(
      groupId,
      target.memberId,
      'admin',
    );

    // Demote every other current active owner to admin so the Group never
    // ends up with more than one manager as a side effect of a transfer, and
    // never zero (the promoted member above guarantees at least one).
    const members = await this.groupsRepository.listMembers(groupId);
    for (const member of members) {
      if (
        member.role === 'admin' &&
        member.memberStatus === 'active' &&
        member.userId !== newManagerUserId
      ) {
        await this.groupsRepository.updateMemberRole(
          groupId,
          member.id,
          'delegated_lead',
        );
      }
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: actingUserId,
      eventCode: HIERARCHY_EVENT_CODES.groupManagerTransferred,
      message: `Group lead transferred to ${newManagerUserId}`,
      metadata: {
        groupId,
        newManagerUserId,
        previousRole,
      },
    });

    return group;
  }

  async listMembers(
    groupId: string,
    userId: string,
  ): Promise<GroupMemberRecord[]> {
    await this.accessService.assertGroupMembership(groupId, userId);
    return this.groupsRepository.listMembers(groupId);
  }

  async updateMemberRole(
    groupId: string,
    userId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<GroupMemberRecord> {
    await this.accessService.assertGroupRole(groupId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const target = await this.groupsRepository.findMemberById(
      groupId,
      memberId,
    );
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    if (dto.role === 'admin' && target.role !== 'admin') {
      throw new ForbiddenException(
        'Ownership only changes via the transfer endpoint',
      );
    }

    // Race-free last-owner guard: changeMemberRoleGuarded holds a row lock
    // on every active owner of the Group for the duration of the check +
    // write, so two concurrent demotions of two different owners can no
    // longer both read "2 owners" and both proceed to zero (ciso finding,
    // plan §3.3 "last-manager protection ... race-condition safety").
    const { member: updated, blockedLastOwner } =
      await this.groupsRepository.changeMemberRoleGuarded(
        groupId,
        memberId,
        dto.role,
      );
    if (blockedLastOwner) {
      throw new BadRequestException('Group must keep at least one owner');
    }
    if (!updated) {
      throw new NotFoundException('Member not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.memberRoleChanged,
      message: `Member role changed to ${dto.role}`,
      metadata: {
        groupId,
        memberId,
        targetUserId: target.userId,
        previousRole: target.role,
        newRole: dto.role,
      },
    });

    return updated;
  }

  /**
   * Offboarding event, not a hard delete. Cascades to a revoke job for every
   * active repository assignment this member holds anywhere in the Group
   * (plan §2.4, source §4/§11 "removing a member must immediately trigger
   * the repository-assignment access review").
   */
  async removeMember(
    groupId: string,
    userId: string,
    memberId: string,
    reason?: string,
  ): Promise<GroupMemberRecord> {
    await this.accessService.assertGroupRole(groupId, userId, [
      'admin',
      'delegated_lead',
    ]);
    const target = await this.groupsRepository.findMemberById(
      groupId,
      memberId,
    );
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    // Race-free last-owner guard — same locked check-then-act pattern as
    // updateMemberRole above (ciso finding, plan §3.3).
    const { member: removed, blockedLastOwner } =
      await this.groupsRepository.removeMemberGuarded(
        groupId,
        memberId,
        userId,
        reason,
      );
    if (blockedLastOwner) {
      throw new BadRequestException('Group must keep at least one owner');
    }
    if (!removed) {
      throw new NotFoundException('Member not found');
    }

    const assignments =
      await this.assignmentsRepository.listAssignedByUserWithinGroup(
        groupId,
        target.userId,
      );
    for (const assignment of assignments) {
      await this.githubSyncService.requestRevoke(assignment.id, userId);
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.memberRemoved,
      message: `Member removed from Group`,
      metadata: {
        groupId,
        memberId,
        targetUserId: target.userId,
        reason: reason ?? null,
        cascadedRevokeCount: assignments.length,
      },
    });

    return removed;
  }
}
