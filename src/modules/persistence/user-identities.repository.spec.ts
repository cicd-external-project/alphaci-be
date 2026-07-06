import type { DatabaseService } from '../database/database.service.js';
import { UserIdentitiesRepository } from './user-identities.repository.js';

const makeDatabaseService = () =>
  ({
    query: jest.fn(),
  }) as unknown as DatabaseService;

describe('UserIdentitiesRepository', () => {
  it('finds an active identity by provider and provider user id', async () => {
    const db = makeDatabaseService();
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: 'identity-1',
          user_id: 'user-1',
          provider: 'github',
          provider_user_id: '123',
          email: 'tone@example.test',
          normalized_email: 'tone@example.test',
          email_verified: true,
          password_hash: null,
          display_name: 'Tone',
          avatar_url: 'https://example.test/avatar.png',
          archived_at: null,
        },
      ],
    });

    const repo = new UserIdentitiesRepository(db);
    const result = await repo.findByProviderIdentity('github', '123');

    expect(result).toMatchObject({
      id: 'identity-1',
      userId: 'user-1',
      provider: 'github',
      providerUserId: '123',
      emailVerified: true,
      archivedAt: null,
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM identity.user_identities ui'),
      ['github', '123'],
    );
  });

  it('returns verified email matches across identities and canonical user email', async () => {
    const db = makeDatabaseService();
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ user_id: 'user-1' }],
    });

    const repo = new UserIdentitiesRepository(db);
    const result = await repo.findActiveUserIdsByVerifiedEmail(
      'Tone@Example.Test',
    );

    expect(result).toEqual(['user-1']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('lower($1)'),
      ['Tone@Example.Test'],
    );
  });

  it('links an oauth identity without password hash', async () => {
    const db = makeDatabaseService();
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: 'identity-1',
          user_id: 'user-1',
          provider: 'google',
          provider_user_id: 'google-sub',
          email: 'tone@example.test',
          normalized_email: 'tone@example.test',
          email_verified: true,
          password_hash: null,
          display_name: 'Tone',
          avatar_url: 'https://example.test/a.png',
          archived_at: null,
        },
      ],
    });

    const repo = new UserIdentitiesRepository(db);
    const result = await repo.upsertIdentity({
      userId: 'user-1',
      provider: 'google',
      providerUserId: 'google-sub',
      email: 'tone@example.test',
      emailVerified: true,
      displayName: 'Tone',
      avatarUrl: 'https://example.test/a.png',
    });

    expect(result.userId).toBe('user-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [
      'user-1',
      'google',
      'google-sub',
      'tone@example.test',
      'tone@example.test',
      true,
      null,
      'Tone',
      'https://example.test/a.png',
    ]);
  });
});
