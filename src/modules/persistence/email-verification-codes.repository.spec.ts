import type { DatabaseService } from '../database/database.service.js';
import { EmailVerificationCodesRepository } from './email-verification-codes.repository.js';

const makeDatabaseService = () =>
  ({
    query: jest.fn(),
  }) as unknown as DatabaseService;

describe('EmailVerificationCodesRepository', () => {
  it('creates a hashed verification code row', async () => {
    const db = makeDatabaseService();
    const expiresAt = new Date('2026-07-06T00:10:00Z');
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'code-1' }] });

    const repo = new EmailVerificationCodesRepository(db);
    const result = await repo.create({
      normalizedEmail: 'tone@example.test',
      codeHash: 'hash',
      purpose: 'signup',
      pendingIdentityId: 'identity-1',
      expiresAt,
    });

    expect(result).toEqual({ id: 'code-1' });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'INSERT INTO identity.email_verification_codes',
      ),
      ['tone@example.test', 'hash', 'signup', 'identity-1', expiresAt],
    );
  });

  it('finds the latest active code for an email and purpose', async () => {
    const db = makeDatabaseService();
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: 'code-1',
          normalized_email: 'tone@example.test',
          code_hash: 'hash',
          pending_identity_id: 'identity-1',
          attempt_count: 0,
          sent_count: 1,
          expires_at: '2026-07-06T00:10:00.000Z',
        },
      ],
    });

    const repo = new EmailVerificationCodesRepository(db);
    const result = await repo.findLatestActive('tone@example.test', 'signup');

    expect(result?.id).toBe('code-1');
    expect(result?.codeHash).toBe('hash');
    expect(result?.pendingIdentityId).toBe('identity-1');
  });
});
