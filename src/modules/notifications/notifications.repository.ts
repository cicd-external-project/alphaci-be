import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  eventCode: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  enabled: true;
  items: NotificationItem[];
  unreadCount: number;
}

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  event_code: string;
  read_at: string | Date | null;
  created_at: string | Date;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listForUser(userId: string): Promise<NotificationsResponse> {
    const result = await this.databaseService.query<NotificationRow>(
      `
        SELECT id, title, body, event_code, read_at, created_at
        FROM notifications.notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50;
      `,
      [userId],
    );

    const items = result.rows.map((row) => this.toItem(row));
    return {
      enabled: true,
      items,
      unreadCount: items.filter((item) => item.readAt === null).length,
    };
  }

  async markRead(userId: string, id: string): Promise<{ id: string; read: true }> {
    const result = await this.databaseService.query<{ id: string }>(
      `
        UPDATE notifications.notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1
          AND user_id = $2
        RETURNING id;
      `,
      [id, userId],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('Notification not found');
    }

    return { id: result.rows[0].id, read: true };
  }

  private toItem(row: NotificationRow): NotificationItem {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      eventCode: row.event_code,
      readAt: this.toIsoStringOrNull(row.read_at),
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private toIsoString(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private toIsoStringOrNull(value: string | Date | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }
}
