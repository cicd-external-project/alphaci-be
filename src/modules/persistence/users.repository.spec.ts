import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { UsersRepository } from './users.repository.js';
import { DatabaseService } from '../database/database.service.js';

const fakeRow = {
  id: 'user-uuid-1',
  login: 'testuser',
  display_name: 'Test User',
  email: 'test@example.com',
  avatar_url: 'https://example.com/avatar.png',
};

const makeDatabaseService = (row = fakeRow) =>
  ({
    query: jest.fn().mockResolvedValue({ rows: [row] }),
  }) as unknown as DatabaseService;

describe('UsersRepository', () => {
  let repo: UsersRepository;
  let db: DatabaseService;

  beforeEach(async () => {
    db = makeDatabaseService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    repo = module.get(UsersRepository);
  });

  it('should be defined', () => {
    expect(repo).toBeDefined();
  });

  describe('upsertGitHubUser', () => {
    it('returns a mapped SessionUser', async () => {
      const result = await repo.upsertGitHubUser({
        githubUserId: 'gh-123',
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(result).toMatchObject({
        id: 'user-uuid-1',
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
      });
    });

    it('throws when upsert returns no row', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(
        repo.upsertGitHubUser({
          githubUserId: 'gh-456',
          login: 'norow',
        }),
      ).rejects.toThrow('Upsert returned no row');
    });

    it('normalizes login with special characters', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ ...fakeRow, login: 'user-name' }],
      });

      const result = await repo.upsertGitHubUser({
        githubUserId: 'gh-789',
        login: 'User Name!',
      });

      expect(result.login).toBe('user-name');
    });
  });

  describe('upsertGoogleUser', () => {
    it('returns a mapped SessionUser', async () => {
      const result = await repo.upsertGoogleUser({
        googleUserId: 'google-123',
        login: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
      });

      expect(result.id).toBe('user-uuid-1');
      expect(result.login).toBe('testuser');
    });

    it('throws when upsert returns no row', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(
        repo.upsertGoogleUser({ googleUserId: 'g-456', login: 'norow' }),
      ).rejects.toThrow('Upsert returned no row');
    });
  });

  describe('findById', () => {
    it('returns a SessionUser when found', async () => {
      const result = await repo.findById('user-uuid-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-uuid-1');
    });

    it('returns null when not found', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const result = await repo.findById('missing-id');
      expect(result).toBeNull();
    });

    it('omits email and avatarUrl when null in DB', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ ...fakeRow, email: null, avatar_url: null }],
      });

      const result = await repo.findById('user-uuid-1');
      expect(result).not.toBeNull();
      expect('email' in result!).toBe(false);
      expect('avatarUrl' in result!).toBe(false);
    });
  });
});
