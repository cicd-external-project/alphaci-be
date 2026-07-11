import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('identity federation migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260706091358_identity_federation.sql',
    ),
    'utf8',
  );

  it('allows canonical users to be created from email, Google, and GitHub auth', () => {
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS app_users_provider_check',
    );
    expect(migration).toContain(
      "CHECK (provider IN ('github', 'google', 'email'))",
    );
  });
});
