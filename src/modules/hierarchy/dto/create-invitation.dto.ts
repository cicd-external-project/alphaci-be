import { IsIn, IsString, MinLength } from 'class-validator';

import type { InvitableRole } from '../hierarchy.types';

const INVITABLE_ROLES: InvitableRole[] = ['delegated_lead', 'member', 'viewer'];

export class CreateInvitationDto {
  @IsString()
  @MinLength(1)
  inviteeUserId: string = '';

  @IsIn(INVITABLE_ROLES)
  role: InvitableRole = 'member';
}
