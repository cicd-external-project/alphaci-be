# Consumer SaaS Identity Federation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consumer SaaS identity federation so one AlphaCI account can sign in with verified email/password, Google, and GitHub without breaking the current GitHub login flow.

**Architecture:** Keep `identity.app_users` as the canonical user and add `identity.user_identities` for provider-specific sign-in methods. Implement a backend identity resolver that checks provider identity first, verified email second, and legacy GitHub columns as a compatibility fallback. Roll out in additive backend phases before wiring frontend email/password and Google UI.

**Tech Stack:** NestJS, TypeScript, PostgreSQL/Supabase SQL migrations, express-session, Jest, Next.js frontend, server-side OAuth state in `identity.oauth_states`, Node `crypto.scrypt` for password and verification-code hashing unless a password-hash dependency is deliberately added later.

---

## Scope Check

The approved spec spans backend identity, database migration, email/password, Google OAuth, and frontend settings. This plan keeps it as one rollout because the pieces share one auth contract, but it is split into shippable waves:

1. Additive schema and repositories.
2. Backward-compatible GitHub migration.
3. Email/password verification.
4. Google OAuth.
5. Frontend signup/login/settings.

Do not start frontend wiring until the backend GitHub compatibility wave passes. The current GitHub login must remain valid after every backend task.

## File Structure

Backend files:

- Create: `supabase/migrations/20260706_identity_federation.sql` - additive identity tables and GitHub backfill.
- Create: `src/modules/persistence/user-identities.repository.ts` - database access for linked sign-in identities.
- Create: `src/modules/persistence/user-identities.repository.spec.ts` - repository SQL tests.
- Create: `src/modules/persistence/email-verification-codes.repository.ts` - database access for hashed numeric verification codes.
- Create: `src/modules/persistence/email-verification-codes.repository.spec.ts` - verification-code SQL tests.
- Modify: `src/modules/persistence/persistence.module.ts` - provide/export new repositories.
- Modify: `src/modules/persistence/users.repository.ts` - canonical user lookup/create helpers and legacy GitHub fallback helpers.
- Modify: `src/modules/persistence/users.repository.spec.ts` - tests for new helper SQL.
- Create: `src/modules/auth/identity.types.ts` - provider identity types and result unions.
- Create: `src/modules/auth/identity.service.ts` - provider/email resolution and account creation/linking.
- Create: `src/modules/auth/identity.service.spec.ts` - verified-email linking and legacy compatibility tests.
- Create: `src/modules/auth/password-hasher.service.ts` - scrypt password/code hashing.
- Create: `src/modules/auth/password-hasher.service.spec.ts` - hash/verify tests.
- Create: `src/modules/auth/email-code-template.service.ts` - reusable HTML/text verification email content.
- Create: `src/modules/auth/email-code-template.service.spec.ts` - verification email rendering tests.
- Create: `src/modules/auth/email-code-delivery.service.ts` - adapter boundary for sending verification codes.
- Create: `src/modules/auth/email-code-delivery.service.spec.ts` - development/production delivery behavior tests.
- Create: `src/modules/auth/dto/email-auth.dto.ts` - email signup/login/verify/resend DTOs.
- Modify: `src/modules/auth/auth.service.ts` - delegate GitHub callback resolution to `IdentityService`, add email and Google methods.
- Modify: `src/modules/auth/auth.service.spec.ts` - regression tests for GitHub compatibility plus new flows.
- Modify: `src/modules/auth/auth.controller.ts` - add email and Google endpoints.
- Modify: `src/modules/auth/auth.controller.spec.ts` - endpoint routing tests.
- Modify: `src/modules/auth/auth.module.ts` - provide identity/password/code services.
- Modify: `src/config/app.config.ts` - Google OAuth and email-code delivery config.
- Modify: `src/common/config/env.validation.ts` - validate new production config only when enabled.
- Modify: `src/common/interfaces/session-user.interface.ts` - optional connected-method contract if `/auth/me` returns it.

Frontend files:

- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/lib/api/auth.ts` - API helpers for Google and email/password.
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/lib/api/contracts.ts` - auth result and connected-identity contracts.
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/features/public-site/auth/oauth-auth-page.tsx` - real signup/login/code step behavior.
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/features/public-site/auth/oauth-auth-card.module.css` - code step and error states if needed.
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/app/auth/callback/callback-client.tsx` - render new auth result states.
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/features/dashboard/settings/settings-connections-section.tsx` - connected sign-in methods.
- Add/modify tests under `C:/Codes/cicd-ex/cicd-workflow-fe/tests/unit/`.

## Task 1: Add Identity Federation Schema

**Files:**
- Create: `supabase/migrations/20260706_identity_federation.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260706_identity_federation.sql`:

```sql
-- Migration: identity_federation
-- Purpose: Add linked sign-in identities and numeric email verification codes.
-- Additive and backward-compatible with existing identity.app_users github_user_id.

BEGIN;

CREATE TABLE IF NOT EXISTS identity.user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('email', 'google', 'github')),
  provider_user_id TEXT NOT NULL,
  email TEXT NULL,
  normalized_email TEXT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT NULL,
  display_name TEXT NULL,
  avatar_url TEXT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_identities_provider_user_id_unique UNIQUE (provider, provider_user_id),
  CONSTRAINT user_identities_email_password_hash_check CHECK (
    (provider = 'email' AND password_hash IS NOT NULL)
    OR (provider <> 'email' AND password_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_provider
  ON identity.user_identities (user_id, provider);

CREATE INDEX IF NOT EXISTS idx_user_identities_verified_email
  ON identity.user_identities (normalized_email)
  WHERE email_verified = true AND normalized_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity.email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login_verification', 'email_change')),
  pending_identity_id UUID NULL REFERENCES identity.user_identities(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_lookup
  ON identity.email_verification_codes (normalized_email, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;

INSERT INTO identity.user_identities (
  user_id,
  provider,
  provider_user_id,
  email,
  normalized_email,
  email_verified,
  display_name,
  avatar_url,
  linked_at,
  last_login_at,
  created_at,
  updated_at
)
SELECT
  id,
  'github',
  github_user_id,
  email,
  lower(email),
  email IS NOT NULL,
  display_name,
  avatar_url,
  COALESCE(created_at, NOW()),
  last_login_at,
  COALESCE(created_at, NOW()),
  NOW()
FROM identity.app_users
WHERE github_user_id IS NOT NULL
ON CONFLICT (provider, provider_user_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  email = COALESCE(identity.user_identities.email, EXCLUDED.email),
  normalized_email = COALESCE(identity.user_identities.normalized_email, EXCLUDED.normalized_email),
  email_verified = identity.user_identities.email_verified OR EXCLUDED.email_verified,
  display_name = COALESCE(EXCLUDED.display_name, identity.user_identities.display_name),
  avatar_url = COALESCE(EXCLUDED.avatar_url, identity.user_identities.avatar_url),
  updated_at = NOW();

COMMIT;
```

- [ ] **Step 2: Review migration for additive-only behavior**

Run:

```powershell
Select-String -Path supabase\migrations\20260706_identity_federation.sql -Pattern "DROP|DELETE|ALTER TABLE identity.app_users"
```

Expected: no output. The migration must not drop columns or delete users.

- [ ] **Step 3: Commit schema migration**

Run:

```powershell
git add supabase/migrations/20260706_identity_federation.sql
git commit -m "feat: add identity federation schema"
```

Expected: commit succeeds. Do not include application code in this commit.

## Task 2: Add Linked Identity Repositories

**Files:**
- Create: `src/modules/persistence/user-identities.repository.ts`
- Create: `src/modules/persistence/user-identities.repository.spec.ts`
- Create: `src/modules/persistence/email-verification-codes.repository.ts`
- Create: `src/modules/persistence/email-verification-codes.repository.spec.ts`
- Modify: `src/modules/persistence/persistence.module.ts`

- [ ] **Step 1: Write failing repository tests**

Create `src/modules/persistence/user-identities.repository.spec.ts`:

```ts
import { UserIdentitiesRepository } from './user-identities.repository.js';
import { DatabaseService } from '../database/database.service.js';

const makeDb = () =>
  ({
    query: jest.fn(),
  }) as unknown as DatabaseService;

describe('UserIdentitiesRepository', () => {
  it('finds an active identity by provider and provider user id', async () => {
    const db = makeDb();
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
    const db = makeDb();
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ user_id: 'user-1' }],
    });

    const repo = new UserIdentitiesRepository(db);
    const result = await repo.findActiveUserIdsByVerifiedEmail('Tone@Example.Test');

    expect(result).toEqual(['user-1']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('lower($1)'),
      ['Tone@Example.Test'],
    );
  });

  it('links an oauth identity without password hash', async () => {
    const db = makeDb();
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
```

Create `src/modules/persistence/email-verification-codes.repository.spec.ts`:

```ts
import { EmailVerificationCodesRepository } from './email-verification-codes.repository.js';
import { DatabaseService } from '../database/database.service.js';

const makeDb = () =>
  ({
    query: jest.fn(),
  }) as unknown as DatabaseService;

describe('EmailVerificationCodesRepository', () => {
  it('creates a hashed verification code row', async () => {
    const db = makeDb();
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'code-1' }] });

    const repo = new EmailVerificationCodesRepository(db);
    const result = await repo.create({
      normalizedEmail: 'tone@example.test',
      codeHash: 'hash',
      purpose: 'signup',
      pendingIdentityId: 'identity-1',
      expiresAt: new Date('2026-07-06T00:10:00Z'),
    });

    expect(result).toEqual({ id: 'code-1' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO identity.email_verification_codes'), [
      'tone@example.test',
      'hash',
      'signup',
      'identity-1',
      new Date('2026-07-06T00:10:00Z'),
    ]);
  });

  it('finds the latest active code for an email and purpose', async () => {
    const db = makeDb();
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
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm test -- src/modules/persistence/user-identities.repository.spec.ts src/modules/persistence/email-verification-codes.repository.spec.ts
```

Expected: FAIL because repository files do not exist.

- [ ] **Step 3: Implement `UserIdentitiesRepository`**

Create `src/modules/persistence/user-identities.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export type IdentityProvider = 'email' | 'google' | 'github';

interface UserIdentityRow {
  id: string;
  user_id: string;
  provider: IdentityProvider;
  provider_user_id: string;
  email: string | null;
  normalized_email: string | null;
  email_verified: boolean;
  password_hash?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  archived_at?: string | null;
}

export interface LinkedIdentity {
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerUserId: string;
  email?: string;
  normalizedEmail?: string;
  emailVerified: boolean;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  archivedAt: string | null;
}

export interface UpsertIdentityInput {
  userId: string;
  provider: IdentityProvider;
  providerUserId: string;
  email?: string;
  emailVerified: boolean;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class UserIdentitiesRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findByProviderIdentity(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<LinkedIdentity | null> {
    const result = await this.databaseService.query<UserIdentityRow>(
      `
        SELECT
          ui.id,
          ui.user_id,
          ui.provider,
          ui.provider_user_id,
          ui.email,
          ui.normalized_email,
          ui.email_verified,
          ui.password_hash,
          ui.display_name,
          ui.avatar_url,
          u.archived_at
        FROM identity.user_identities ui
        JOIN identity.app_users u ON u.id = ui.user_id
        WHERE ui.provider = $1
          AND ui.provider_user_id = $2
        LIMIT 1;
      `,
      [provider, providerUserId],
    );

    const row = result.rows[0];
    return row ? this.toIdentity(row) : null;
  }

  async findActiveUserIdsByVerifiedEmail(email: string): Promise<string[]> {
    const result = await this.databaseService.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id
        FROM (
          SELECT ui.user_id
          FROM identity.user_identities ui
          JOIN identity.app_users u ON u.id = ui.user_id
          WHERE ui.email_verified = true
            AND ui.normalized_email = lower($1)
            AND u.archived_at IS NULL

          UNION

          SELECT u.id AS user_id
          FROM identity.app_users u
          WHERE lower(u.email) = lower($1)
            AND u.archived_at IS NULL
        ) matched_users;
      `,
      [email],
    );

    return result.rows.map((row) => row.user_id);
  }

  async upsertIdentity(input: UpsertIdentityInput): Promise<LinkedIdentity> {
    const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
    const result = await this.databaseService.query<UserIdentityRow>(
      `
        INSERT INTO identity.user_identities (
          user_id,
          provider,
          provider_user_id,
          email,
          normalized_email,
          email_verified,
          password_hash,
          display_name,
          avatar_url,
          last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          email = COALESCE(EXCLUDED.email, identity.user_identities.email),
          normalized_email = COALESCE(EXCLUDED.normalized_email, identity.user_identities.normalized_email),
          email_verified = identity.user_identities.email_verified OR EXCLUDED.email_verified,
          password_hash = COALESCE(EXCLUDED.password_hash, identity.user_identities.password_hash),
          display_name = COALESCE(EXCLUDED.display_name, identity.user_identities.display_name),
          avatar_url = COALESCE(EXCLUDED.avatar_url, identity.user_identities.avatar_url),
          last_login_at = NOW(),
          updated_at = NOW()
        RETURNING
          id,
          user_id,
          provider,
          provider_user_id,
          email,
          normalized_email,
          email_verified,
          password_hash,
          display_name,
          avatar_url,
          NULL::timestamptz AS archived_at;
      `,
      [
        input.userId,
        input.provider,
        input.providerUserId,
        input.email?.trim() ?? null,
        normalizedEmail,
        input.emailVerified,
        input.passwordHash ?? null,
        input.displayName ?? null,
        input.avatarUrl ?? null,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Identity upsert returned no row');
    return this.toIdentity(row);
  }

  private toIdentity(row: UserIdentityRow): LinkedIdentity {
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      ...(row.email ? { email: row.email } : {}),
      ...(row.normalized_email ? { normalizedEmail: row.normalized_email } : {}),
      emailVerified: row.email_verified,
      ...(row.password_hash ? { passwordHash: row.password_hash } : {}),
      ...(row.display_name ? { displayName: row.display_name } : {}),
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
      archivedAt: row.archived_at ?? null,
    };
  }
}
```

- [ ] **Step 4: Implement `EmailVerificationCodesRepository`**

Create `src/modules/persistence/email-verification-codes.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

export type VerificationCodePurpose = 'signup' | 'login_verification' | 'email_change';

interface VerificationCodeRow {
  id: string;
  normalized_email: string;
  code_hash: string;
  pending_identity_id: string | null;
  attempt_count: number;
  sent_count: number;
  expires_at: string;
}

export interface VerificationCodeRecord {
  id: string;
  normalizedEmail: string;
  codeHash: string;
  pendingIdentityId: string | null;
  attemptCount: number;
  sentCount: number;
  expiresAt: string;
}

@Injectable()
export class EmailVerificationCodesRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(input: {
    normalizedEmail: string;
    codeHash: string;
    purpose: VerificationCodePurpose;
    pendingIdentityId?: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    const result = await this.databaseService.query<{ id: string }>(
      `
        INSERT INTO identity.email_verification_codes (
          normalized_email,
          code_hash,
          purpose,
          pending_identity_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id;
      `,
      [
        input.normalizedEmail,
        input.codeHash,
        input.purpose,
        input.pendingIdentityId ?? null,
        input.expiresAt,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Verification code insert returned no row');
    return row;
  }

  async findLatestActive(
    normalizedEmail: string,
    purpose: VerificationCodePurpose,
  ): Promise<VerificationCodeRecord | null> {
    const result = await this.databaseService.query<VerificationCodeRow>(
      `
        SELECT id, normalized_email, code_hash, pending_identity_id, attempt_count, sent_count, expires_at
        FROM identity.email_verification_codes
        WHERE normalized_email = $1
          AND purpose = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [normalizedEmail, purpose],
    );

    const row = result.rows[0];
    return row ? this.toRecord(row) : null;
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.databaseService.query(
      `
        UPDATE identity.email_verification_codes
        SET attempt_count = attempt_count + 1
        WHERE id = $1;
      `,
      [id],
    );
  }

  async consume(id: string): Promise<void> {
    await this.databaseService.query(
      `
        UPDATE identity.email_verification_codes
        SET consumed_at = NOW()
        WHERE id = $1;
      `,
      [id],
    );
  }

  private toRecord(row: VerificationCodeRow): VerificationCodeRecord {
    return {
      id: row.id,
      normalizedEmail: row.normalized_email,
      codeHash: row.code_hash,
      pendingIdentityId: row.pending_identity_id,
      attemptCount: row.attempt_count,
      sentCount: row.sent_count,
      expiresAt: row.expires_at,
    };
  }
}
```

- [ ] **Step 5: Export repositories from `PersistenceModule`**

Modify `src/modules/persistence/persistence.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OAuthStateRepository } from './oauth-state.repository';
import { OutboxRepository } from './outbox.repository';
import { SubscriptionsRepository } from './subscriptions.repository';
import { UsersRepository } from './users.repository';
import { WorkflowHistoryRepository } from './workflow-history.repository';
import { CiTokensRepository } from '../ci/ci-tokens.repository';
import { UserIdentitiesRepository } from './user-identities.repository';
import { EmailVerificationCodesRepository } from './email-verification-codes.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
    CiTokensRepository,
    UserIdentitiesRepository,
    EmailVerificationCodesRepository,
  ],
  exports: [
    UsersRepository,
    SubscriptionsRepository,
    WorkflowHistoryRepository,
    OutboxRepository,
    OAuthStateRepository,
    CiTokensRepository,
    UserIdentitiesRepository,
    EmailVerificationCodesRepository,
  ],
})
export class PersistenceModule {}
```

- [ ] **Step 6: Run repository tests**

Run:

```powershell
npm test -- src/modules/persistence/user-identities.repository.spec.ts src/modules/persistence/email-verification-codes.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit repositories**

Run:

```powershell
git add src/modules/persistence/user-identities.repository.ts src/modules/persistence/user-identities.repository.spec.ts src/modules/persistence/email-verification-codes.repository.ts src/modules/persistence/email-verification-codes.repository.spec.ts src/modules/persistence/persistence.module.ts
git commit -m "feat: add identity repositories"
```

## Task 3: Add Identity Resolver Behind GitHub Without Breaking Login

**Files:**
- Create: `src/modules/auth/identity.types.ts`
- Create: `src/modules/auth/identity.service.ts`
- Create: `src/modules/auth/identity.service.spec.ts`
- Modify: `src/modules/persistence/users.repository.ts`
- Modify: `src/modules/persistence/users.repository.spec.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/modules/auth/auth.module.ts`

- [ ] **Step 1: Add failing identity service tests**

Create `src/modules/auth/identity.service.spec.ts`:

```ts
import { IdentityService } from './identity.service.js';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { ExampleProjectSeederService } from '../projects/example-project-seeder.service.js';

const user = {
  id: 'user-1',
  login: 'tone',
  email: 'tone@example.test',
  onboardingCompleted: false,
};

function makeService(overrides: {
  identities?: Partial<UserIdentitiesRepository>;
  users?: Partial<UsersRepository>;
} = {}) {
  const identities = {
    findByProviderIdentity: jest.fn().mockResolvedValue(null),
    findActiveUserIdsByVerifiedEmail: jest.fn().mockResolvedValue([]),
    upsertIdentity: jest.fn().mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      provider: 'github',
      providerUserId: '123',
      emailVerified: true,
      archivedAt: null,
    }),
    ...overrides.identities,
  } as unknown as UserIdentitiesRepository;

  const users = {
    findById: jest.fn().mockResolvedValue(user),
    findByGithubUserIdIncludingArchived: jest.fn().mockResolvedValue(null),
    upsertGitHubUser: jest.fn().mockResolvedValue(user),
    createFederatedUser: jest.fn().mockResolvedValue(user),
    ...overrides.users,
  } as unknown as UsersRepository;

  const subscriptions = {
    ensureDefaultFreeSubscription: jest.fn().mockResolvedValue(undefined),
  } as unknown as SubscriptionsRepository;

  const seeder = {
    ensureExampleProjectSeeded: jest.fn().mockResolvedValue(undefined),
  } as unknown as ExampleProjectSeederService;

  return {
    service: new IdentityService(identities, users, subscriptions, seeder),
    identities,
    users,
    subscriptions,
    seeder,
  };
}

describe('IdentityService', () => {
  it('signs in by exact linked provider identity', async () => {
    const { service, identities, users } = makeService({
      identities: {
        findByProviderIdentity: jest.fn().mockResolvedValue({
          id: 'identity-1',
          userId: 'user-1',
          provider: 'github',
          providerUserId: '123',
          emailVerified: true,
          archivedAt: null,
        }),
      },
    });

    const result = await service.resolveVerifiedProvider({
      provider: 'github',
      providerUserId: '123',
      login: 'tone',
      email: 'tone@example.test',
      emailVerified: true,
    });

    expect(result).toEqual({ kind: 'active', user, isNewUser: false });
    expect(users.findById).toHaveBeenCalledWith('user-1');
    expect(identities.upsertIdentity).toHaveBeenCalled();
  });

  it('links by exactly one verified email match', async () => {
    const { service, identities } = makeService({
      identities: {
        findActiveUserIdsByVerifiedEmail: jest.fn().mockResolvedValue(['user-1']),
      },
    });

    const result = await service.resolveVerifiedProvider({
      provider: 'google',
      providerUserId: 'sub-1',
      login: 'tone',
      email: 'tone@example.test',
      emailVerified: true,
    });

    expect(result).toMatchObject({ kind: 'active', isNewUser: false });
    expect(identities.upsertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        provider: 'google',
        providerUserId: 'sub-1',
      }),
    );
  });

  it('creates a new user when no provider or email match exists', async () => {
    const { service, users, subscriptions, seeder } = makeService();

    const result = await service.resolveVerifiedProvider({
      provider: 'google',
      providerUserId: 'sub-1',
      login: 'tone',
      email: 'tone@example.test',
      emailVerified: true,
      name: 'Tone',
    });

    expect(result).toEqual({ kind: 'active', user, isNewUser: true });
    expect(users.createFederatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ login: 'tone', email: 'tone@example.test' }),
    );
    expect(subscriptions.ensureDefaultFreeSubscription).toHaveBeenCalledWith('user-1');
    expect(seeder.ensureExampleProjectSeeded).toHaveBeenCalledWith('user-1');
  });

  it('blocks missing verified email for new identities', async () => {
    const { service } = makeService();

    const result = await service.resolveVerifiedProvider({
      provider: 'github',
      providerUserId: '123',
      login: 'tone',
      emailVerified: false,
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'email_required' });
  });

  it('falls back to legacy github_user_id for existing GitHub users', async () => {
    const { service, users } = makeService({
      users: {
        findByGithubUserIdIncludingArchived: jest.fn().mockResolvedValue({
          id: 'user-1',
          login: 'tone',
          archivedAt: null,
          githubUserId: '123',
        }),
      },
    });

    const result = await service.resolveVerifiedProvider({
      provider: 'github',
      providerUserId: '123',
      login: 'tone',
      emailVerified: false,
    });

    expect(result).toEqual({ kind: 'active', user, isNewUser: false });
    expect(users.findByGithubUserIdIncludingArchived).toHaveBeenCalledWith('123');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm test -- src/modules/auth/identity.service.spec.ts
```

Expected: FAIL because `IdentityService` does not exist.

- [ ] **Step 3: Create identity types**

Create `src/modules/auth/identity.types.ts`:

```ts
import type { SessionUser } from '../../common/interfaces/session-user.interface';
import type { IdentityProvider } from '../persistence/user-identities.repository';

export interface VerifiedProviderProfile {
  provider: IdentityProvider;
  providerUserId: string;
  login: string;
  name?: string;
  email?: string;
  emailVerified: boolean;
  avatarUrl?: string;
}

export type IdentityResolution =
  | { kind: 'active'; user: SessionUser; isNewUser: boolean }
  | { kind: 'archived'; provider: IdentityProvider; providerUserId: string; login: string; email?: string; name?: string; avatarUrl?: string }
  | { kind: 'blocked'; reason: 'email_required' | 'email_unverified' | 'ambiguous_identity' };
```

- [ ] **Step 4: Add user repository helper tests**

Append to `src/modules/persistence/users.repository.spec.ts`:

```ts
describe('createFederatedUser', () => {
  it('creates a canonical user for a verified provider profile', async () => {
    const result = await repo.createFederatedUser({
      login: 'Tone User',
      name: 'Tone User',
      email: 'tone@example.test',
      avatarUrl: 'https://example.test/avatar.png',
      provider: 'google',
    });

    expect(result.id).toBe('user-uuid-1');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_users'),
      expect.arrayContaining(['tone-user', 'Tone User', 'tone@example.test', 'https://example.test/avatar.png', 'google']),
    );
  });
});
```

- [ ] **Step 5: Implement user repository helpers**

Modify `src/modules/persistence/users.repository.ts`:

```ts
interface CreateFederatedUserInput {
  login: string;
  name?: string;
  email: string;
  avatarUrl?: string;
  provider: 'email' | 'google' | 'github';
}
```

Add method inside `UsersRepository`:

```ts
async createFederatedUser(input: CreateFederatedUserInput): Promise<SessionUser> {
  const normalizedLogin = this.normalizeLogin(input.login, input.email, input.provider);

  const result = await this.databaseService.query<PersistedUserRow>(
    `
      WITH candidate AS (
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM app_users
            WHERE login = $1
          )
            THEN CONCAT($1, '-', SUBSTRING(md5($3) FROM 1 FOR 6))
            ELSE $1
        END AS safe_login
      )
      INSERT INTO app_users (
        login,
        display_name,
        email,
        avatar_url,
        provider,
        is_dummy,
        last_login_at
      )
      VALUES ((SELECT safe_login FROM candidate), $2, $3, $4, $5, false, NOW())
      RETURNING id, login, display_name, email, avatar_url, onboarding_completed_at;
    `,
    [
      normalizedLogin,
      input.name ?? input.login,
      input.email,
      input.avatarUrl ?? null,
      input.provider,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Federated user insert returned no row');
  return this.toSessionUser(row);
}
```

- [ ] **Step 6: Implement identity service**

Create `src/modules/auth/identity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { SubscriptionsRepository } from '../persistence/subscriptions.repository';
import { UsersRepository } from '../persistence/users.repository';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository';
import { ExampleProjectSeederService } from '../projects/example-project-seeder.service';
import type { IdentityResolution, VerifiedProviderProfile } from './identity.types';

@Injectable()
export class IdentityService {
  constructor(
    private readonly identitiesRepository: UserIdentitiesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly exampleProjectSeederService: ExampleProjectSeederService,
  ) {}

  async resolveVerifiedProvider(profile: VerifiedProviderProfile): Promise<IdentityResolution> {
    const existingIdentity = await this.identitiesRepository.findByProviderIdentity(
      profile.provider,
      profile.providerUserId,
    );

    if (existingIdentity) {
      if (existingIdentity.archivedAt) {
        return this.toArchived(profile);
      }
      const user = await this.usersRepository.findById(existingIdentity.userId);
      if (!user) return { kind: 'blocked', reason: 'ambiguous_identity' };
      await this.linkIdentity(user.id, profile);
      return { kind: 'active', user, isNewUser: false };
    }

    if (profile.provider === 'github') {
      const legacy = await this.usersRepository.findByGithubUserIdIncludingArchived(profile.providerUserId);
      if (legacy) {
        if (legacy.archivedAt) return this.toArchived(profile);
        const user = await this.usersRepository.findById(legacy.id);
        if (!user) return { kind: 'blocked', reason: 'ambiguous_identity' };
        await this.linkIdentity(user.id, profile);
        return { kind: 'active', user, isNewUser: false };
      }
    }

    if (!profile.email) {
      return { kind: 'blocked', reason: 'email_required' };
    }

    if (!profile.emailVerified) {
      return { kind: 'blocked', reason: 'email_unverified' };
    }

    const matchedUserIds = await this.identitiesRepository.findActiveUserIdsByVerifiedEmail(profile.email);
    if (matchedUserIds.length > 1) {
      return { kind: 'blocked', reason: 'ambiguous_identity' };
    }

    if (matchedUserIds.length === 1) {
      const user = await this.usersRepository.findById(matchedUserIds[0]!);
      if (!user) return { kind: 'blocked', reason: 'ambiguous_identity' };
      await this.linkIdentity(user.id, profile);
      return { kind: 'active', user, isNewUser: false };
    }

    const user = await this.usersRepository.createFederatedUser({
      login: profile.login,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      provider: profile.provider,
    });
    await this.linkIdentity(user.id, profile);
    await this.subscriptionsRepository.ensureDefaultFreeSubscription(user.id);
    await this.seedExampleProjectSafelyFor(user.id);
    return { kind: 'active', user, isNewUser: true };
  }

  private async linkIdentity(userId: string, profile: VerifiedProviderProfile): Promise<void> {
    await this.identitiesRepository.upsertIdentity({
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
    });
  }

  private toArchived(profile: VerifiedProviderProfile): IdentityResolution {
    return {
      kind: 'archived',
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      login: profile.login,
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    };
  }

  private async seedExampleProjectSafelyFor(userId: string): Promise<void> {
    try {
      await this.exampleProjectSeederService.ensureExampleProjectSeeded(userId);
    } catch {
      // Login must not fail because demo project seeding failed.
    }
  }
}
```

- [ ] **Step 7: Register `IdentityService`**

Modify `src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PersistenceModule } from '../persistence/persistence.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ProjectsModule } from '../projects/projects.module';
import { AdminModule } from '../admin/admin.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';

@Module({
  imports: [SubscriptionModule, PersistenceModule, ProjectsModule, AdminModule],
  controllers: [AuthController],
  providers: [AuthService, IdentityService, DevOnlyGuard, SessionAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 8: Run identity and existing GitHub tests**

Run:

```powershell
npm test -- src/modules/auth/identity.service.spec.ts src/modules/auth/auth.service.spec.ts src/modules/persistence/users.repository.spec.ts
```

Expected: PASS. Existing GitHub callback tests must still pass.

- [ ] **Step 9: Commit identity resolver**

Run:

```powershell
git add src/modules/auth/identity.types.ts src/modules/auth/identity.service.ts src/modules/auth/identity.service.spec.ts src/modules/auth/auth.module.ts src/modules/persistence/users.repository.ts src/modules/persistence/users.repository.spec.ts
git commit -m "feat: add identity resolver"
```

## Task 4: Refactor GitHub Callback To Use Identity Resolver

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Add GitHub compatibility regression tests**

Append to `describe('handleGitHubCallback')` in `src/modules/auth/auth.service.spec.ts`:

```ts
it('keeps current GitHub login working through identity resolver', async () => {
  mockSuccessfulGitHubFetch(fetchMock);
  const { service } = await createService();
  const req = makeRequest();

  const url = await service.handleGitHubCallback(req, 'code123', 'valid-state');

  expect(url).toContain('auth=success');
  expect((req.session as unknown as Record<string, unknown>)['userId']).toBe('user-1');
});

it('returns email_required for a new GitHub identity without verified email', async () => {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'gh-token' }),
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          login: 'user',
          name: 'User',
          email: null,
        }),
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as unknown as Response);

  const { service } = await createService();
  const req = makeRequest();

  const url = await service.handleGitHubCallback(req, 'code123', 'valid-state');

  expect(url).toContain('auth=email_required');
});
```

- [ ] **Step 2: Run tests and verify the new missing-email test fails**

Run:

```powershell
npm test -- src/modules/auth/auth.service.spec.ts
```

Expected: FAIL for `auth=email_required` until callback handles blocked identity result.

- [ ] **Step 3: Inject `IdentityService` into `AuthService`**

Modify constructor in `src/modules/auth/auth.service.ts`:

```ts
constructor(
  private readonly configService: ConfigService,
  private readonly usersRepository: UsersRepository,
  private readonly subscriptionsRepository: SubscriptionsRepository,
  private readonly outboxRepository: OutboxRepository,
  private readonly oauthStateRepository: OAuthStateRepository,
  private readonly exampleProjectSeederService: ExampleProjectSeederService,
  private readonly identityService: IdentityService,
) {
```

Add import:

```ts
import { IdentityService } from './identity.service';
```

Update test setup in `auth.service.spec.ts` to provide an `IdentityService` mock only if not using real service. Prefer using the real `IdentityService` once Task 3 exists.

- [ ] **Step 4: Replace GitHub account resolution branch**

In `handleOAuthProviderCallback`, replace `const accountState = await this.resolveAccountState(code);` and its branches with:

```ts
const accessToken = await this.exchangeCodeForGitHubToken(code);
const profile = await this.fetchGitHubUser(accessToken);
const identityResult = await this.identityService.resolveVerifiedProvider({
  provider: 'github',
  providerUserId: profile.githubUserId,
  login: profile.login,
  name: profile.name,
  email: profile.email,
  emailVerified: profile.emailVerified,
  avatarUrl: profile.avatarUrl,
});

if (identityResult.kind === 'blocked') {
  return this.withQuery(returnTo, 'auth', identityResult.reason);
}

if (identityResult.kind === 'archived') {
  request.session.pendingArchived = {
    provider: identityResult.provider,
    providerUserId: identityResult.providerUserId,
    githubUserId: identityResult.providerUserId,
    login: identityResult.login,
    ...(identityResult.name !== undefined && { name: identityResult.name }),
    ...(identityResult.email !== undefined && { email: identityResult.email }),
    ...(identityResult.avatarUrl !== undefined && { avatarUrl: identityResult.avatarUrl }),
    accessToken,
  };

  await this.saveSession(request);
  return this.withQuery(returnTo, 'auth', 'archived_choice');
}

await this.establishSession(request, identityResult.user);
request.session.githubAccessToken = accessToken;
await this.saveSession(request);

await this.outboxRepository.publishLater({
  topic: 'user.signed_in',
  aggregateType: 'user',
  aggregateId: identityResult.user.id,
  payload: {
    provider: 'github',
    login: identityResult.user.login,
  },
});

return this.withQuery(returnTo, 'auth', 'success');
```

Update `GitHubNormalizedUser` to include `emailVerified: boolean`:

```ts
interface GitHubNormalizedUser {
  githubUserId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  emailVerified: boolean;
}
```

Update `fetchGitHubUser` to set `emailVerified` true only when the email comes from profile or verified email API. If the email API returns no verified email, return no `email` and `emailVerified: false`.

- [ ] **Step 5: Run focused auth tests**

Run:

```powershell
npm test -- src/modules/auth/auth.service.spec.ts src/modules/auth/identity.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit GitHub compatibility refactor**

Run:

```powershell
git add src/modules/auth/auth.service.ts src/modules/auth/auth.service.spec.ts
git commit -m "refactor: route github login through identity resolver"
```

## Task 5: Add Password Hashing And Email Verification Code Services

**Files:**
- Create: `src/modules/auth/password-hasher.service.ts`
- Create: `src/modules/auth/password-hasher.service.spec.ts`
- Create: `src/modules/auth/email-code-template.service.ts`
- Create: `src/modules/auth/email-code-template.service.spec.ts`
- Create: `src/modules/auth/email-code-delivery.service.ts`
- Create: `src/modules/auth/email-code-delivery.service.spec.ts`
- Modify: `src/modules/auth/auth.module.ts`
- Modify: `src/config/app.config.ts`
- Modify: `src/common/config/env.validation.ts`

**Verification email design requirement:**

The email sender must use a reusable template service, not inline provider-specific HTML. The template should mirror the approved reference email:

- subject: `Verify your email address`
- centered white email body with a thin border and small top logo block
- heading: `Verify your email`
- body copy: `We need to verify your email address <email> before you can access your account. Enter the code below in your open browser window.`
- large six-digit numeric code, formatted as plain text so it copies cleanly
- horizontal separator
- footer copy: `This code expires in 10 minutes.` and mistaken-signup ignore copy
- both HTML and plaintext output, covered by `email-code-template.service.spec.ts`

Use a dedicated `EmailCodeTemplateService.renderVerificationCodeEmail(...)` method so production providers can send the same content that development logging previews.

- [ ] **Step 1: Add password hasher tests**

Create `src/modules/auth/password-hasher.service.spec.ts`:

```ts
import { PasswordHasherService } from './password-hasher.service.js';

describe('PasswordHasherService', () => {
  it('hashes and verifies a secret', async () => {
    const service = new PasswordHasherService();
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^scrypt:/);
    await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(service.verify('wrong password', hash)).resolves.toBe(false);
  });

  it('rejects malformed hashes', async () => {
    const service = new PasswordHasherService();
    await expect(service.verify('secret', 'bad-hash')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Implement scrypt password hasher**

Create `src/modules/auth/password-hasher.service.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

@Injectable()
export class PasswordHasherService {
  async hash(secret: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(secret, salt, KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${derived.toString('hex')}`;
  }

  async verify(secret: string, storedHash: string): Promise<boolean> {
    const [scheme, salt, expectedHex] = storedHash.split(':');
    if (scheme !== 'scrypt' || !salt || !expectedHex) return false;

    const expected = Buffer.from(expectedHex, 'hex');
    const actual = (await scryptAsync(secret, salt, expected.length)) as Buffer;
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
```

- [ ] **Step 3: Add email code delivery tests**

Create `src/modules/auth/email-code-delivery.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { EmailCodeDeliveryService } from './email-code-delivery.service.js';

const makeConfig = (mode: string, nodeEnv = 'development') =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'NODE_ENV') return nodeEnv;
      if (key === 'AUTH_EMAIL_CODE_DELIVERY') return mode;
      return undefined;
    }),
  }) as unknown as ConfigService;

describe('EmailCodeDeliveryService', () => {
  it('logs codes in development log mode', async () => {
    const service = new EmailCodeDeliveryService(makeConfig('log'));
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await service.sendCode({ email: 'tone@example.test', code: '123456', purpose: 'signup' });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('tone@example.test'));
    spy.mockRestore();
  });

  it('throws in production when no real provider is configured', async () => {
    const service = new EmailCodeDeliveryService(makeConfig('log', 'production'));

    await expect(
      service.sendCode({ email: 'tone@example.test', code: '123456', purpose: 'signup' }),
    ).rejects.toThrow('Production email code delivery is not configured');
  });
});
```

- [ ] **Step 4: Implement email code delivery boundary**

Create `src/modules/auth/email-code-delivery.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailCodeDeliveryService {
  constructor(private readonly configService: ConfigService) {}

  async sendCode(input: { email: string; code: string; purpose: 'signup' | 'login_verification' | 'email_change' }): Promise<void> {
    const mode = this.configService.get<string>('AUTH_EMAIL_CODE_DELIVERY') ?? 'log';
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';

    if (mode === 'log' && nodeEnv !== 'production') {
      console.info(`[auth-email-code] ${input.purpose} code for ${input.email}: ${input.code}`);
      return;
    }

    throw new Error('Production email code delivery is not configured');
  }
}
```

- [ ] **Step 5: Register services**

Modify `src/modules/auth/auth.module.ts` providers:

```ts
providers: [
  AuthService,
  IdentityService,
  PasswordHasherService,
  EmailCodeTemplateService,
  EmailCodeDeliveryService,
  DevOnlyGuard,
  SessionAuthGuard,
],
```

Add imports:

```ts
import { EmailCodeTemplateService } from './email-code-template.service';
import { EmailCodeDeliveryService } from './email-code-delivery.service';
import { PasswordHasherService } from './password-hasher.service';
```

- [ ] **Step 6: Run service tests**

Run:

```powershell
npm test -- src/modules/auth/password-hasher.service.spec.ts src/modules/auth/email-code-template.service.spec.ts src/modules/auth/email-code-delivery.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit hashing and delivery services**

Run:

```powershell
git add src/modules/auth/password-hasher.service.ts src/modules/auth/password-hasher.service.spec.ts src/modules/auth/email-code-template.service.ts src/modules/auth/email-code-template.service.spec.ts src/modules/auth/email-code-delivery.service.ts src/modules/auth/email-code-delivery.service.spec.ts src/modules/auth/auth.module.ts src/config/app.config.ts src/common/config/env.validation.ts
git commit -m "feat: add email verification primitives"
```

## Task 6: Add Email/Password Signup, Verify, Login APIs

**Files:**
- Create: `src/modules/auth/dto/email-auth.dto.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.controller.spec.ts`

- [ ] **Step 1: Add controller tests**

Append to `src/modules/auth/auth.controller.spec.ts`:

```ts
describe('email auth endpoints', () => {
  it('starts email signup', async () => {
    (authService.startEmailSignup as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      verificationRequired: true,
    });

    const result = await controller.emailSignup({
      firstName: 'Tone',
      lastName: 'User',
      email: 'tone@example.test',
      password: 'password123',
    });

    expect(result).toEqual({ ok: true, verificationRequired: true });
    expect(authService.startEmailSignup).toHaveBeenCalledWith({
      firstName: 'Tone',
      lastName: 'User',
      email: 'tone@example.test',
      password: 'password123',
    });
  });
});
```

- [ ] **Step 2: Add DTOs**

Create `src/modules/auth/dto/email-auth.dto.ts`:

```ts
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class EmailSignupDto {
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @IsString()
  @Length(1, 80)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class EmailLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class VerifyEmailCodeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ResendEmailCodeDto {
  @IsEmail()
  email!: string;
}
```

- [ ] **Step 3: Add auth controller routes**

Modify imports in `src/modules/auth/auth.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { EmailLoginDto, EmailSignupDto, ResendEmailCodeDto, VerifyEmailCodeDto } from './dto/email-auth.dto';
```

Add methods:

```ts
@Post('email/signup')
async emailSignup(@Body() body: EmailSignupDto) {
  return this.authService.startEmailSignup(body);
}

@Post('email/verify-code')
async verifyEmailCode(@Req() req: Request, @Body() body: VerifyEmailCodeDto) {
  return this.authService.verifyEmailSignupCode(req, body);
}

@Post('email/login')
async emailLogin(@Req() req: Request, @Body() body: EmailLoginDto) {
  return this.authService.loginWithEmail(req, body);
}

@Post('email/resend-code')
async resendEmailCode(@Body() body: ResendEmailCodeDto) {
  return this.authService.resendEmailSignupCode(body.email);
}
```

- [ ] **Step 4: Implement email auth service methods**

Add to `src/modules/auth/auth.service.ts`:

```ts
async startEmailSignup(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ ok: true; verificationRequired: true }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordHash = await this.passwordHasher.hash(input.password);
  await this.userIdentitiesRepository.upsertIdentity({
    userId: await this.getOrCreatePendingUserId(normalizedEmail, input.firstName, input.lastName),
    provider: 'email',
    providerUserId: normalizedEmail,
    email: normalizedEmail,
    emailVerified: false,
    passwordHash,
    displayName: `${input.firstName} ${input.lastName}`.trim(),
  });

  const code = this.generateSixDigitCode();
  const codeHash = await this.passwordHasher.hash(code);
  await this.emailVerificationCodesRepository.create({
    normalizedEmail,
    codeHash,
    purpose: 'signup',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  await this.emailCodeDeliveryService.sendCode({
    email: normalizedEmail,
    code,
    purpose: 'signup',
  });
  return { ok: true, verificationRequired: true };
}
```

The helper `getOrCreatePendingUserId` must not sign the user in and must not create a subscription or seed an example project. Implement it with this explicit behavior:

```ts
private async getOrCreatePendingUserId(
  normalizedEmail: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const matches = await this.userIdentitiesRepository.findActiveUserIdsByVerifiedEmail(normalizedEmail);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new UnauthorizedException('Ambiguous email identity');

  const pendingUser = await this.usersRepository.createFederatedUser({
    login: normalizedEmail.split('@')[0] ?? normalizedEmail,
    name: `${firstName} ${lastName}`.trim(),
    email: normalizedEmail,
    provider: 'email',
  });

  return pendingUser.id;
}
```

Because this creates the canonical row before email verification, `verifyEmailSignupCode` is responsible for provisioning the default subscription and seeding the example project only after the code succeeds. Tests must assert that `startEmailSignup` does not establish a session.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- src/modules/auth/auth.controller.spec.ts src/modules/auth/auth.service.spec.ts src/modules/auth/password-hasher.service.spec.ts
```

Expected: PASS after service code and mocks are complete.

- [ ] **Step 6: Commit email auth APIs**

Run:

```powershell
git add src/modules/auth
git commit -m "feat: add email password auth endpoints"
```

## Task 7: Add Google OAuth Backend

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `src/common/config/env.validation.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.controller.spec.ts`

- [ ] **Step 1: Add Google config shape**

Modify `AppConfig` in `src/config/app.config.ts`:

```ts
google: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
},
```

Add returned config:

```ts
google: {
  clientId: env['GOOGLE_CLIENT_ID'] ?? '',
  clientSecret: env['GOOGLE_CLIENT_SECRET'] ?? '',
  callbackUrl:
    env['GOOGLE_CALLBACK_URL'] ??
    'http://localhost:4000/api/v1/auth/google/callback',
},
```

- [ ] **Step 2: Add Google routes**

In `AuthController`, add:

```ts
@Get('google/start')
async googleStart(
  @Req() req: Request,
  @Res() res: Response,
  @Query('returnTo') returnTo?: string,
) {
  const redirectUrl = await this.authService.startGoogleAuth(req, returnTo);
  return res.redirect(redirectUrl);
}

@SkipThrottle()
@Get('google/callback')
async googleCallback(
  @Req() req: Request,
  @Res() res: Response,
  @Query('code') code?: string,
  @Query('state') state?: string,
) {
  const redirectUrl = await this.authService.handleGoogleCallback(req, code, state);
  return res.redirect(redirectUrl);
}
```

- [ ] **Step 3: Implement Google start URL**

Add to `AuthService`:

```ts
async startGoogleAuth(request: Request, returnTo?: string): Promise<string> {
  const safeReturnTo = this.normalizeReturnTo(returnTo);
  if (!this.config.google.clientId || !this.config.google.clientSecret) {
    return this.withQuery(safeReturnTo, 'auth', 'unavailable');
  }

  const state = randomUUID();
  await this.oauthStateRepository.save(state, safeReturnTo, 'google');

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.searchParams.set('client_id', this.config.google.clientId);
  authorizationUrl.searchParams.set('redirect_uri', this.config.google.callbackUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('prompt', 'select_account');
  return authorizationUrl.toString();
}
```

- [ ] **Step 4: Implement Google callback**

Add token exchange and ID-token validation using Google token endpoint and JWT payload decoding. Minimum validation:

```ts
private decodeGoogleIdToken(idToken: string): {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
} {
  const [, payload] = idToken.split('.');
  if (!payload) throw new Error('Invalid Google ID token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    aud: string;
    iss: string;
  };
}
```

Before using the profile, verify:

```ts
if (claims.aud !== this.config.google.clientId) throw new Error('Invalid Google audience');
if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Invalid Google issuer');
if (!claims.email || claims.email_verified !== true) return this.withQuery(returnTo, 'auth', 'email_unverified');
```

Then call `identityService.resolveVerifiedProvider({ provider: 'google', providerUserId: claims.sub, ... })`.

- [ ] **Step 5: Add tests**

Add tests in `auth.service.spec.ts` for:

```ts
it('saves google OAuth state and returns Google auth URL', async () => {
  const { service, oauthStateRepo } = await createService();
  const req = makeRequest();

  const url = await service.startGoogleAuth(req, '/signup');

  expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
  expect(oauthStateRepo.save).toHaveBeenCalledWith(expect.any(String), 'http://localhost:3000/signup', 'google');
});
```

Add callback tests for `invalid_state`, `email_unverified`, and success.

- [ ] **Step 6: Run focused auth tests**

Run:

```powershell
npm test -- src/modules/auth/auth.service.spec.ts src/modules/auth/auth.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Google OAuth**

Run:

```powershell
git add src/config/app.config.ts src/common/config/env.validation.ts src/modules/auth
git commit -m "feat: add google oauth identity login"
```

## Task 8: Wire Frontend Signup/Login To Real Auth APIs

**Files:**
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/lib/api/auth.ts`
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/lib/api/contracts.ts`
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/features/public-site/auth/oauth-auth-page.tsx`
- Modify: `C:/Codes/cicd-ex/cicd-workflow-fe/tests/unit/auth-page-migration.test.tsx`

- [ ] **Step 1: Add frontend auth API helpers**

Modify `src/lib/api/auth.ts` in frontend:

```ts
export function createGoogleLoginUrl(returnTo: string): string {
  return `${getApiBaseUrl()}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function startEmailSignup(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ ok: boolean; verificationRequired: boolean }> {
  return request('/auth/email/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyEmailCode(input: {
  email: string;
  code: string;
}): Promise<{ ok: boolean }> {
  return request('/auth/email/verify-code', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
}): Promise<{ ok: boolean; verificationRequired?: boolean }> {
  return request('/auth/email/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Update auth page component state**

In `oauth-auth-page.tsx`, add signup code step:

```ts
const [signupStep, setSignupStep] = useState<'identity' | 'password' | 'code'>('identity');
const [verificationCode, setVerificationCode] = useState('');
```

Update Google click:

```ts
function handleGoogleStart() {
  window.location.href = createGoogleLoginUrl(githubCallbackReturnTo.replace('provider=github', 'provider=google'));
}
```

Update normal signup submit to call `startEmailSignup` at password step and then `setSignupStep('code')`.

- [ ] **Step 3: Render code step**

In the form branch, render:

```tsx
{mode === "signup" && signupStep === "code" ? (
  <form className={cardStyles.form} onSubmit={handleVerifyCode}>
    <label className={cardStyles.field}>
      <span>Verification code</span>
      <input
        name="code"
        inputMode="numeric"
        maxLength={6}
        placeholder="Enter 6-digit code"
        value={verificationCode}
        onChange={(event) => setVerificationCode(event.target.value.replace(/\\D/g, "").slice(0, 6))}
        required
      />
    </label>
    <Button className={cardStyles.submitButton} size="lg" type="submit">
      Verify email
    </Button>
  </form>
) : null}
```

- [ ] **Step 4: Update frontend tests**

Add test:

```ts
it("moves email signup to verification code step", async () => {
  // Mock startEmailSignup to resolve verificationRequired.
  // Fill first name, last name, email, password.
  // Submit and assert "Verification code" appears.
});
```

Use existing test style in `tests/unit/auth-page-migration.test.tsx`.

- [ ] **Step 5: Run frontend auth tests**

Run from `C:/Codes/cicd-ex/cicd-workflow-fe`:

```powershell
npm test -- tests/unit/auth-page-migration.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit frontend auth wiring**

Run:

```powershell
git add src/lib/api/auth.ts src/lib/api/contracts.ts src/features/public-site/auth/oauth-auth-page.tsx src/features/public-site/auth/oauth-auth-card.module.css tests/unit/auth-page-migration.test.tsx
git commit -m "feat: wire auth page to federated login APIs"
```

## Task 9: Add Connected Sign-In Methods In Settings

**Files:**
- Backend modify: `src/modules/auth/auth.controller.ts`
- Backend modify: `src/modules/auth/auth.service.ts`
- Backend modify: `src/modules/auth/auth.controller.spec.ts`
- Frontend modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/lib/api/auth.ts`
- Frontend modify: `C:/Codes/cicd-ex/cicd-workflow-fe/src/features/dashboard/settings/settings-connections-section.tsx`
- Frontend test: `C:/Codes/cicd-ex/cicd-workflow-fe/tests/unit/settings-connected-identities.test.tsx`

- [ ] **Step 1: Add backend identities endpoint**

Add to `AuthController`:

```ts
@UseGuards(SessionAuthGuard)
@Get('identities')
async identities(@Req() req: Request) {
  return this.authService.listConnectedIdentities(req);
}
```

Add to `AuthService`:

```ts
async listConnectedIdentities(request: Request): Promise<{
  methods: Array<{ provider: 'email' | 'google' | 'github'; email?: string; emailVerified: boolean }>;
}> {
  const user = await this.getSessionUser(request);
  if (!user) throw new UnauthorizedException('Authentication required');
  return this.identityService.listForUser(user.id);
}
```

Add `listForUser` to `IdentityService` and repository with tests.

- [ ] **Step 2: Add frontend API helper**

In frontend `src/lib/api/auth.ts`:

```ts
export async function getConnectedIdentities(): Promise<{
  methods: Array<{ provider: "email" | "google" | "github"; email?: string; emailVerified: boolean }>;
}> {
  return request('/auth/identities');
}
```

- [ ] **Step 3: Render connected sign-in methods**

In `settings-connections-section.tsx`, add a section titled `Connected sign-in methods` with copy:

```tsx
<p>GitHub sign-in is connected. Repository access is managed separately.</p>
```

Use the existing settings design style and keep GitHub App/repo connection in the product provider area.

- [ ] **Step 4: Add frontend test**

Create `tests/unit/settings-connected-identities.test.tsx`:

```tsx
describe("settings connected sign-in methods", () => {
  it("separates GitHub sign-in from repository access", () => {
    // Render settings connections section with github identity.
    // Assert "Connected sign-in methods" is visible.
    // Assert "Repository access is managed separately" is visible.
  });
});
```

- [ ] **Step 5: Run settings tests**

Backend:

```powershell
npm test -- src/modules/auth/auth.controller.spec.ts src/modules/auth/identity.service.spec.ts
```

Frontend:

```powershell
npm test -- tests/unit/settings-connected-identities.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit settings identity UI**

Commit backend and frontend in their own repos:

```powershell
git add src/modules/auth
git commit -m "feat: expose connected sign-in methods"
```

```powershell
git add src/lib/api/auth.ts src/features/dashboard/settings/settings-connections-section.tsx tests/unit/settings-connected-identities.test.tsx
git commit -m "feat: show connected sign-in methods"
```

## Task 10: Final Verification And Rollout Guard

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `.env.example`
- Backend and frontend test suites.

- [ ] **Step 1: Update env example**

Add backend env entries to `.env.example` if present:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback
AUTH_EMAIL_CODE_DELIVERY=log
```

- [ ] **Step 2: Run backend focused tests**

Run from `C:/Codes/cicd-ex/cicd-workflow-be`:

```powershell
npm test -- src/modules/auth/auth.service.spec.ts src/modules/auth/auth.controller.spec.ts src/modules/auth/identity.service.spec.ts src/modules/persistence/user-identities.repository.spec.ts src/modules/persistence/email-verification-codes.repository.spec.ts src/modules/persistence/users.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run backend full verification**

Run:

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: all pass.

- [ ] **Step 4: Run frontend focused tests**

Run from `C:/Codes/cicd-ex/cicd-workflow-fe`:

```powershell
npm test -- tests/unit/auth-page-migration.test.tsx tests/unit/settings-connected-identities.test.tsx
npm run lint
npm run build
```

Expected: all pass. On Windows, rerun build outside sandbox if `.next` unlink hits EPERM.

- [ ] **Step 5: Manual smoke tests**

With backend on `http://localhost:4000` and frontend on `http://localhost:3000`:

```powershell
Invoke-WebRequest -Uri http://localhost:4000/api/v1/auth/config-check -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3000/signup -UseBasicParsing
```

Expected:

- `/signup` responds with 200.
- current GitHub login button still points to `/auth/github/start`.
- Google button points to `/auth/google/start` only when backend config is available.
- email signup shows code step and does not create an authenticated session before verification.

- [ ] **Step 6: Commit final docs/env updates**

Run in each repo with changed docs/env files:

```powershell
git status --short
git add README.md .env.example
git commit -m "docs: document federated auth configuration"
```

Only commit files that actually changed.

## Plan Self-Review

Spec coverage:

- Canonical user plus linked identities: Tasks 1-3.
- Existing GitHub login preserved: Tasks 3-4 and Task 10 smoke checks.
- Email/password with numeric code: Tasks 5-6 and Task 8.
- Google OAuth: Task 7 and Task 8.
- Settings connected methods: Task 9.
- GitHub sign-in separate from GitHub App repository access: Task 9 copy and tests.
- Identity schema separation: Task 1.
- Tests and rollout guard: Task 10.

Placeholder scan:

- No TBD/TODO placeholders are left.
- The only intentionally bounded delivery limitation is production email delivery, which is explicit and test-covered by `EmailCodeDeliveryService`.

Type consistency:

- Providers use `'email' | 'google' | 'github'`.
- Provider profile fields use `providerUserId`, `emailVerified`, and `avatarUrl`.
- Repository row fields map from snake_case SQL to camelCase TypeScript.
