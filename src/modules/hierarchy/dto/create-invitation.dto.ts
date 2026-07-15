import { IsString, MinLength } from 'class-validator';

// Invitations no longer carry a role: everyone joins as a plain Member and a
// Lead promotes them afterward via PATCH /groups/:groupId/members/:memberId.
export class CreateInvitationDto {
  @IsString()
  @MinLength(1)
  inviteeUserId: string = '';
}
