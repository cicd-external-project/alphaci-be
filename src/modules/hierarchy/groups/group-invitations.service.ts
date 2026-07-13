import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditEventsService } from '../../audit/audit-events.service';
import { HierarchyAccessService } from '../hierarchy-access.service';
import { HIERARCHY_EVENT_CODES, type InvitableRole } from '../hierarchy.types';
import {
  GroupsRepository,
  type GroupInvitationRecord,
} from './groups.repository';

@Injectable()
export class GroupInvitationsService {
  constructor(
    private readonly groupsRepository: GroupsRepository,
    private readonly accessService: HierarchyAccessService,
    private readonly auditEventsService: AuditEventsService,
  ) {}

  async createInvitation(
    groupId: string,
    actorUserId: string,
    input: { inviteeUserId: string; role: InvitableRole },
  ): Promise<GroupInvitationRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(
      groupId,
      actorUserId,
    );

    // Approved internal user directory gate (source plan §4 step 4; plan §6
    // open question #2 treats is_internal=true as that directory pending
    // user confirmation).
    const invitee = await this.groupsRepository.findInternalUserById(
      input.inviteeUserId,
    );
    if (!invitee) {
      throw new NotFoundException(
        'User not found in the approved internal directory',
      );
    }

    const existingMembership = await this.groupsRepository.findActiveMembership(
      groupId,
      input.inviteeUserId,
    );
    if (existingMembership) {
      throw new BadRequestException(
        'User is already an active member of this Group',
      );
    }

    const invitation = await this.groupsRepository.createInvitation({
      groupId,
      invitedUserId: input.inviteeUserId,
      invitedBy: actorUserId,
      role: input.role,
    });

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId,
      eventCode: HIERARCHY_EVENT_CODES.invitationCreated,
      message: `Invitation created for role ${input.role}`,
      metadata: {
        groupId,
        invitationId: invitation.id,
        inviteeUserId: input.inviteeUserId,
        role: input.role,
      },
    });

    return invitation;
  }

  async listInvitations(
    groupId: string,
    userId: string,
  ): Promise<GroupInvitationRecord[]> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(groupId, userId);
    return this.groupsRepository.listInvitations(groupId);
  }

  async acceptInvitation(
    invitationId: string,
    userId: string,
  ): Promise<GroupInvitationRecord> {
    const invitation = await this.requireInviteeOwnedInvitation(
      invitationId,
      userId,
    );

    await this.groupsRepository.activateMembershipFromInvitation(
      invitation.groupId,
      userId,
      invitation.role,
      invitation.invitedBy,
    );
    const updated = await this.groupsRepository.setInvitationStatus(
      invitationId,
      'accepted',
    );
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: invitation.groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.invitationAccepted,
      message: 'Invitation accepted',
      metadata: { groupId: invitation.groupId, invitationId },
    });

    return updated;
  }

  async declineInvitation(
    invitationId: string,
    userId: string,
  ): Promise<GroupInvitationRecord> {
    const invitation = await this.requireInviteeOwnedInvitation(
      invitationId,
      userId,
    );

    const updated = await this.groupsRepository.setInvitationStatus(
      invitationId,
      'declined',
    );
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: invitation.groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.invitationDeclined,
      message: 'Invitation declined',
      metadata: { groupId: invitation.groupId, invitationId },
    });

    return updated;
  }

  async revokeInvitation(
    groupId: string,
    userId: string,
    invitationId: string,
  ): Promise<GroupInvitationRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(groupId, userId);
    const invitation =
      await this.groupsRepository.findInvitationById(invitationId);
    if (!invitation || invitation.groupId !== groupId) {
      throw new NotFoundException('Invitation not found');
    }

    const updated = await this.groupsRepository.setInvitationStatus(
      invitationId,
      'revoked',
    );
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.invitationRevoked,
      message: 'Invitation revoked',
      metadata: { groupId, invitationId },
    });

    return updated;
  }

  private async requireInviteeOwnedInvitation(
    invitationId: string,
    userId: string,
  ): Promise<GroupInvitationRecord> {
    const invitation =
      await this.groupsRepository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.invitedUserId !== userId) {
      throw new ForbiddenException('This invitation does not belong to you');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer pending');
    }
    return invitation;
  }
}
