import { NotFoundException } from '@nestjs/common';

import type { DatabaseService } from '../database/database.service';
import { NotificationsRepository } from './notifications.repository';

const makeDatabaseService = (query: jest.Mock) =>
  ({ query }) as unknown as DatabaseService;

describe('NotificationsRepository', () => {
  let query: jest.Mock;
  let repository: NotificationsRepository;

  beforeEach(() => {
    query = jest.fn();
    repository = new NotificationsRepository(makeDatabaseService(query));
  });

  it('lists notifications and computes unread count', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'notification-1',
          title: 'Workflow update',
          body: 'A workflow PR was created.',
          event_code: 'workflow_pr_created',
          read_at: null,
          created_at: new Date('2026-06-14T00:00:00.000Z'),
        },
        {
          id: 'notification-2',
          title: 'Deployment',
          body: 'Deployment completed.',
          event_code: 'deployment_completed',
          read_at: '2026-06-14T01:00:00.000Z',
          created_at: '2026-06-14T00:30:00.000Z',
        },
      ],
    });

    await expect(repository.listForUser('user-1')).resolves.toEqual({
      enabled: true,
      items: [
        {
          id: 'notification-1',
          title: 'Workflow update',
          body: 'A workflow PR was created.',
          eventCode: 'workflow_pr_created',
          readAt: null,
          createdAt: '2026-06-14T00:00:00.000Z',
        },
        {
          id: 'notification-2',
          title: 'Deployment',
          body: 'Deployment completed.',
          eventCode: 'deployment_completed',
          readAt: '2026-06-14T01:00:00.000Z',
          createdAt: '2026-06-14T00:30:00.000Z',
        },
      ],
      unreadCount: 1,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM notifications.notifications'),
      ['user-1'],
    );
  });

  it('marks a notification read for the owning user', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'notification-1' }] });

    await expect(
      repository.markRead('user-1', 'notification-1'),
    ).resolves.toEqual({ id: 'notification-1', read: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET read_at = COALESCE(read_at, NOW())'),
      ['notification-1', 'user-1'],
    );
  });

  it('throws when a notification is not found for the user', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(repository.markRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
