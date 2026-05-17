import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { UsersRepository } from '../../modules/persistence/users.repository';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly usersRepository: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.session?.user && !request.session?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!request.session.user && request.session.userId) {
      const user = await this.usersRepository.findById(request.session.userId);

      if (!user) {
        throw new UnauthorizedException('Authentication required');
      }

      request.session.user = user;
      request.session.userId = user.id;
    }

    return true;
  }
}
