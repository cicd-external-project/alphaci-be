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
    input: { inviteeUserId: string },
  ): Promise<GroupInvitationRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(
      groupId,
      actorUserId,
    );

    // Everyone joins a Group as a plain Member (product rule: only the
    // Group owner starts as Lead/Admin; a Lead promotes members afterward via
    // PATCH /groups/:groupId/members/:memberId). Invitations therefore never
    // carry a role — the grant is always 'member'.
    const role: InvitableRole = 'member';

    // Approved internal user directory gate: the invitee must have an AlphaCI
    // account (matched to a GitHub org member at the picker layer). Org
    // members with no account cannot be invited until they sign in.
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
      role,
    });

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId,
      eventCode: HIERARCHY_EVENT_CODES.invitationCreated,
      message: `Invitation created for role ${role}`,
      metadata: {
        groupId,
        invitationId: invitation.id,
        inviteeUserId: input.inviteeUserId,
        role,
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
