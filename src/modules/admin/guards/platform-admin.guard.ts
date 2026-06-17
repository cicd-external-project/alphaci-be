import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PlatformAdminsRepository } from '../platform-admins.repository';

/**
 * PlatformAdminGuard — allows only platform admins (role 'admin' or 'super_admin').
 *
 * Designed to run AFTER SessionAuthGuard (which populates req.session.user), e.g.
 *   @UseGuards(SessionAuthGuard, PlatformAdminGuard)
 * Apply it at the CONTROLLER level so every admin route is locked by default and a
 * new endpoint cannot accidentally ship unguarded.
 *
 * Returns 403 (the user is authenticated but lacks the role).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly platformAdminsRepository: PlatformAdminsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.session?.user?.id ?? request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const role = await this.platformAdminsRepository.findRole(userId);
    if (role === null) {
      throw new ForbiddenException('Platform admin access required');
    }

    return true;
  }
}
