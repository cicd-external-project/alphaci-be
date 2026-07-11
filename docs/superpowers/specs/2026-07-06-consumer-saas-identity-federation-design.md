# Consumer SaaS Identity Federation Design

Date: 2026-07-06
Status: Approved for implementation planning
Owner: AlphaCI

## Summary

AlphaCI will use a consumer SaaS identity model: one canonical AlphaCI user account can have multiple verified sign-in methods. Google, GitHub, and email/password are login identities attached to the same AlphaCI user when they prove ownership of the same verified email.

This design keeps GitHub sign-in separate from GitHub product access. Signing in with GitHub proves identity. Installing or connecting the GitHub App grants repository access and remains a separate product connection.

The current GitHub login flow must continue working during the migration because the same backend serves the main AlphaCI auth path. The implementation must be backward-compatible, migratable in phases, and safe to deploy before the frontend fully switches over.

## Goals

- Support Google OAuth, GitHub OAuth, and email/password login.
- Treat the same verified email across providers as the same AlphaCI account when the match is unambiguous.
- Preserve the existing session-cookie auth model.
- Preserve current GitHub login behavior while introducing the linked-identity model.
- Keep identity data in the existing `identity` schema, separate from product schemas.
- Keep GitHub repository access separate from sign-in identity.
- Add Settings visibility for connected sign-in methods.

## Non-Goals

- Enterprise SAML or OIDC SSO.
- Organization-domain auto-provisioning.
- Replacing the current backend session-cookie model.
- Moving to Supabase Auth.
- Treating GitHub OAuth as GitHub App repository access.

## Current State

The backend owns authentication and sessions. It stores canonical users in `identity.app_users`, persists OAuth state in `identity.oauth_states`, and serves session state through `/auth/me`.

GitHub OAuth is implemented today. It resolves users mainly by GitHub provider ID and stores GitHub profile data directly on `identity.app_users`. The identity schema already has a `google_user_id` concept from earlier migrations, but Google OAuth is not fully wired through the backend callback flow. The frontend has Google and GitHub buttons, but Google is currently UI-only.

The migration must not break:

- `GET /auth/github/start`
- `GET /auth/github/callback`
- existing session cookies
- `/auth/me`
- archived account restore/start-fresh behavior
- existing users with `identity.app_users.github_user_id`

## Data Model

### `identity.app_users`

This remains the canonical AlphaCI account row. It should represent the product user, not a provider account.

It owns:

- `id`
- canonical `email`
- `login`
- `display_name`
- `avatar_url`
- onboarding state
- archived state
- user-level timestamps and metadata

Provider-specific identity data should no longer be the main lookup surface after migration, though existing columns can stay during the compatibility phase.

### `identity.user_identities`

Add one row per sign-in method.

Recommended columns:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES identity.app_users(id) ON DELETE CASCADE`
- `provider TEXT NOT NULL CHECK (provider IN ('email', 'google', 'github'))`
- `provider_user_id TEXT NOT NULL`
- `email TEXT`
- `normalized_email TEXT`
- `email_verified BOOLEAN NOT NULL DEFAULT false`
- `password_hash TEXT`
- `display_name TEXT`
- `avatar_url TEXT`
- `linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `last_login_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Constraints and indexes:

- unique `(provider, provider_user_id)`
- partial unique index for verified email identity if needed, scoped carefully
- index `(normalized_email)` where `email_verified = true`
- index `(user_id, provider)`

For provider IDs:

- GitHub uses the numeric GitHub user ID as text.
- Google uses the OIDC `sub` claim.
- Email/password uses normalized email as `provider_user_id`.

For `provider = 'email'`, `password_hash` is required after password setup. For OAuth providers, `password_hash` must be null.

### `identity.email_verification_codes`

Add short-lived numeric code records for email/password signup and verification.

Recommended columns:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `normalized_email TEXT NOT NULL`
- `code_hash TEXT NOT NULL`
- `purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login_verification', 'email_change'))`
- `pending_identity_id UUID NULL REFERENCES identity.user_identities(id) ON DELETE CASCADE`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `sent_count INTEGER NOT NULL DEFAULT 1`
- `expires_at TIMESTAMPTZ NOT NULL`
- `consumed_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Codes are never stored in plaintext. They expire, are rate-limited, and are invalidated after successful verification.

## Account Resolution Rules

Every provider callback or credential login should resolve identity in this order:

1. Exact provider identity match.
   If `(provider, provider_user_id)` exists, sign in the linked `user_id` if the account is active.

2. Verified email match.
   If the incoming identity has a verified email and it matches exactly one active `identity.app_users` canonical email or verified linked identity, attach the new identity to that user and sign in.

3. Create new account.
   If no active match exists and the incoming email is verified, create `identity.app_users`, attach the identity, create the default free subscription, seed onboarding/example data, and sign in.

4. Block unsafe cases.
   If the email is unverified, missing, archived, or ambiguous, do not auto-link into an active account.

## Provider Flows

### Email/Password Signup

1. User submits name, email, and password.
2. Backend normalizes email.
3. Backend creates or updates a pending `email` identity with hashed password.
4. Backend sends a 6-digit numeric verification code.
5. User enters the code.
6. Backend verifies the hashed code and marks the email identity verified.
7. Backend resolves by verified email:
   - link to existing active user if exactly one match exists
   - otherwise create a new `identity.app_users`
8. Backend starts the normal session.

Unverified email/password users cannot sign in. They remain in the "check your email for the code" state with resend and change-email options.

### Email/Password Login

1. User submits email and password.
2. Backend finds the `email` identity by normalized email.
3. Backend verifies password hash.
4. If the identity is verified, sign in the linked user.
5. If the identity is unverified, redirect or respond with a verification-required state and allow code resend.

### Google OAuth

1. Frontend starts Google login through the backend.
2. Backend saves OAuth state in `identity.oauth_states` with `provider = 'google'`.
3. Callback exchanges the code and validates the Google ID token.
4. Backend requires `email_verified = true`.
5. Backend uses Google `sub` as `provider_user_id`.
6. Backend resolves provider identity first, then verified email.
7. Backend links, creates, or signs in according to the common account resolution rules.

### GitHub OAuth

1. Existing GitHub start/callback routes continue working.
2. Callback exchanges code for access token.
3. Backend fetches GitHub profile and verified primary email through the `user:email` scope.
4. Backend requires a verified email for new linked-identity resolution.
5. Backend uses GitHub numeric ID as `provider_user_id`.
6. Backend resolves provider identity first, then verified email.
7. Backend links, creates, or signs in according to the common account resolution rules.

If GitHub does not provide a verified email, the backend blocks sign-in and asks the user to use Google or email signup. Existing migrated GitHub identities remain valid by provider ID so current users are not locked out during rollout.

## Backward Compatibility And Migration

Current GitHub login must keep working throughout the migration.

Phased migration:

1. Add `identity.user_identities` and `identity.email_verification_codes` without removing existing columns.
2. Backfill GitHub identities from existing `identity.app_users.github_user_id`.
3. Update auth resolution to check `identity.user_identities` first, then fall back to legacy `identity.app_users.github_user_id`.
4. Keep writing both the linked identity and the legacy GitHub columns during the transition.
5. Once live traffic is verified, make `identity.user_identities` the authoritative provider lookup.
6. Only later consider deprecating legacy provider columns on `identity.app_users`.

Compatibility requirements:

- Existing GitHub users must sign in without re-linking.
- Existing sessions remain valid.
- Existing archived-account logic must continue to work.
- Existing subscriptions, workspaces, projects, GitHub App installations, and audit records must keep referencing the same `identity.app_users.id`.
- The first deployment must be additive and reversible.

## Archived Accounts

Archived account behavior should become provider-neutral.

If a provider identity maps to an archived user:

- do not authenticate immediately
- store a pending archived-account payload in the session
- show the existing restore/start-fresh choice
- if restored, restore the same `identity.app_users.id`
- if start-fresh, hard-delete the archived user and create a new account through the normal identity creation path

The pending archived payload should contain provider, provider user ID, verified email, display name, avatar URL, and any token needed to complete the current flow.

## Settings UX

Settings should expose sign-in methods separately from product connections.

Account settings:

- show canonical profile email
- show display name and avatar

Connected sign-in methods:

- Email/password
- Google
- GitHub

Allowed actions:

- connect missing Google or GitHub while signed in
- verify email/password if pending
- eventually remove a sign-in method only when at least one verified method remains

Blocked actions:

- remove the last verified sign-in method
- link an OAuth provider whose verified email belongs to another active account while signed in, unless the user explicitly resolves the conflict through a safe flow

GitHub repository access remains under product/provider connections. Copy should make this clear:

- "GitHub sign-in is connected. Repository access is managed separately."
- "Install the GitHub App to grant AlphaCI repository access."

## Error Handling

The API should return explicit provider-result states that the frontend can render:

- `success`
- `invalid_state`
- `unavailable`
- `failed`
- `email_unverified`
- `email_required`
- `ambiguous_identity`
- `archived_choice`
- `verification_required`
- `code_invalid`
- `code_expired`
- `rate_limited`

Provider failure should not produce silent fallback account creation.

## Security Requirements

- Auto-link only verified emails.
- Normalize email consistently before matching.
- Never link by display name, provider username, or unverified email.
- Store passwords with Argon2id or bcrypt using current cost settings.
- Store numeric verification codes hashed, not plaintext.
- Rate-limit code sends and verification attempts.
- Use OAuth state for every provider callback.
- Validate Google ID tokens against configured client ID and issuer.
- Keep provider tokens server-side only.
- Do not store provider tokens in browser storage.
- Emit audit events for identity linked, login succeeded, login failed, code sent, and provider blocked.

## API Surface

Existing routes:

- `GET /auth/github/start`
- `GET /auth/github/callback`
- `GET /auth/me`
- `POST /auth/logout`
- archived-account routes

New or expanded routes:

- `GET /auth/google/start`
- `GET /auth/google/callback`
- `POST /auth/email/signup`
- `POST /auth/email/verify-code`
- `POST /auth/email/login`
- `POST /auth/email/resend-code`
- `GET /auth/identities`
- `POST /auth/identities/:provider/start-link`
- future `DELETE /auth/identities/:id`

`/auth/me` may include connected method metadata for Settings, or Settings may call `GET /auth/identities` separately.

## Frontend Scope

Signup:

- name, email, password form
- 6-digit code step
- resend code
- change email
- Continue with Google
- Continue with GitHub

Login:

- email/password form
- Continue with Google
- Continue with GitHub
- verification-required state for unverified email identities

Settings:

- connected sign-in methods
- connect missing Google/GitHub
- clear separation from GitHub App/repository access

## Testing

Backend tests:

- exact provider identity match signs in existing user
- verified Google email links to existing email/password account
- verified GitHub email links to existing Google account
- same verified email across email, Google, and GitHub maps to one `app_users.id`
- unverified Google/GitHub email is blocked
- missing GitHub email is blocked for new identities
- legacy GitHub users can still sign in through `github_user_id`
- archived account choice still works with GitHub and new providers
- email code expires
- wrong code increments attempt count
- resend is rate-limited
- password hash verification succeeds and fails correctly

Migration tests:

- backfill creates one GitHub identity per existing `github_user_id`
- backfill is idempotent
- no user IDs change
- subscriptions, projects, workspaces, and GitHub App installation rows remain attached to the same user IDs

Frontend tests:

- signup renders normal form and provider options
- code step renders after email signup
- login handles verification-required response
- Google button calls backend route
- Settings renders connected sign-in methods
- GitHub repository access copy remains separate from sign-in copy

## Rollout Plan

1. Add schema and backfill migrations.
2. Add identity resolution service behind existing GitHub flow.
3. Verify current GitHub login still works.
4. Add email/password signup and verification code flow.
5. Add Google OAuth.
6. Add Settings connected sign-in methods.
7. Monitor sign-in failures, identity-link events, and archived-account decisions.
8. After live verification, reduce reliance on legacy provider columns.

## Open Decisions

All product-level decisions are resolved for implementation planning:

- use consumer SaaS model
- include Google, GitHub, and email/password
- use numeric email verification codes
- auto-link verified email matches when unambiguous
- block missing or unverified provider emails
- keep GitHub identity separate from GitHub repository access
- keep data in the `identity` schema
- preserve current GitHub login while migrating
