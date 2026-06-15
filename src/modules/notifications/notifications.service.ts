import { Injectable } from '@nestjs/common';

import {
  NotificationsRepository,
  type NotificationsResponse,
} from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  listForUser(userId: string): Promise<NotificationsResponse> {
    return this.repository.listForUser(userId);
  }

  markRead(userId: string, id: string): Promise<{ id: string; read: true }> {
    return this.repository.markRead(userId, id);
  }
}
