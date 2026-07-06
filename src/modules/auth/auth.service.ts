import { randomInt, randomUUID } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '../../config/app.config';
import type { SessionUser } from '../../common/interfaces/session-user.interface';
import { EmailVerificationCodesRepository } from '../persistence/email-verification-codes.repository';
import { OAuthStateRepository } from '../persistence/oauth-state.repository';
import { OutboxRepository } from '../persistence/outbox.repository';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository';
import { UsersRepository } from '../persistence/users.repository';
import { ExampleProjectSeederService } from '../projects/example-project-seeder.service';
import { EmailCodeDeliveryService } from './email-code-delivery.service';
import { IdentityService } from './identity.service';
import { PasswordHasherService } from './password-hasher.service';

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
}

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
}
interface GitHubUserResponse {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
  email?: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubNormalizedUser {
  githubUserId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  emailVerified: boolean;
}


export interface PendingAccountInfo {
  pending: true;
  login: string;
  archivedAt: string;
  purgeAt: string;
  retentionDays: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config: AppConfig;
  private readonly returnToOrigins: Set<string>;
  private readonly returnToOriginPatterns: RegExp[];

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly oauthStateRepository: OAuthStateRepository,
    private readonly exampleProjectSeederService: ExampleProjectSeederService,
    private readonly identityService: IdentityService,
    private readonly userIdentitiesRepository: UserIdentitiesRepository,
    private readonly emailVerificationCodesRepository: EmailVerificationCodesRepository,
    private readonly passwordHasher: PasswordHasherService,
    private readonly emailCodeDeliveryService: EmailCodeDeliveryService,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
    this.returnToOrigins = this.buildReturnToOrigins(
      this.config.frontendUrl,
      this.configService.get<string>('ALLOWED_ORIGINS'),
    );
    // The OAuth returnTo allow-list must mirror the CORS allow-list
    // (security.config.ts). CORS honors ALLOWED_ORIGIN_PATTERNS so that Vercel
    // preview deployments (e.g. https://cicd-workflow-<hash>.vercel.app) can
    // call the API; the post-login redirect must honor the SAME patterns or it
    // silently falls back to FRONTEND_URL and strands the user on the wrong
    // (often stale) frontend deployment.
    this.returnToOriginPatterns = this.buildReturnToOriginPatterns(
      this.configService.get<string>('ALLOWED_ORIGIN_PATTERNS'),
    );
  }

  async startGitHubAuth(request: Request, returnTo?: string): Promise<string> {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasGitHubCredentials()) {
      return this.withQuery(safeReturnTo, 'auth', 'unavailable');
    }

    try {
      const state = randomUUID();

      // Store OAuth state in DB — eliminates the session cookie dependency for
      // state verification. The cookie race condition on cold starts is moot
      // because state lives in Supabase, not the session store.
      await this.oauthStateRepository.save(state, safeReturnTo, 'github');

      // Probabilistic cleanup: prune expired rows on ~5% of login starts.
      // This keeps the table lean without adding a cron dependency. The prune
      // is fire-and-forget (errors are caught inside pruneExpired) so it never
      // blocks or fails the login flow.
      if (randomInt(100) < 5) {
        void this.oauthStateRepository.pruneExpired();
      }

      return this.buildGitHubAuthorizationUrl(state);
    } catch (err) {
      this.logger.error(
        `OAuth start failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withQuery(safeReturnTo, 'auth', 'failed');
    }
  }

  async handleGitHubCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    return this.handleOAuthProviderCallback(request, code, state);
  }
  async startGoogleAuth(request: Request, returnTo?: string): Promise<string> {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasGoogleCredentials()) {
      return this.withQuery(safeReturnTo, 'auth', 'unavailable');
    }

    try {
      const state = randomUUID();
      await this.oauthStateRepository.save(state, safeReturnTo, 'google');

      const authorizationUrl = new URL(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      authorizationUrl.searchParams.set(
        'client_id',
        this.config.google!.clientId,
      );
      authorizationUrl.searchParams.set(
        'redirect_uri',
        this.config.google!.callbackUrl,
      );
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('scope', 'openid email profile');
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set('prompt', 'select_account');

      return authorizationUrl.toString();
    } catch (err) {
      this.logger.error(
        `Google OAuth start failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withQuery(safeReturnTo, 'auth', 'failed');
    }
  }

  async handleGoogleCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    const fallbackReturnTo = `${this.config.frontendUrl}/auth/callback`;

    try {
      const oauthRecord =
        code && state
          ? await this.oauthStateRepository.findAndDelete(state)
          : null;
      const returnTo = oauthRecord?.returnTo ?? fallbackReturnTo;

      if (!code || !state || oauthRecord?.provider !== 'google') {
        return this.withQuery(returnTo, 'auth', 'invalid_state');
      }

      if (!this.hasGoogleCredentials()) {
        return this.withQuery(returnTo, 'auth', 'unavailable');
      }

      const idToken = await this.exchangeCodeForGoogleIdToken(code);
      const claims = this.decodeGoogleIdToken(idToken);
      this.validateGoogleClaims(claims);

      if (!claims.email || claims.email_verified !== true) {
        return this.withQuery(returnTo, 'auth', 'email_unverified');
      }

      const login = claims.email.split('@')[0] ?? claims.email;
      const identityResult = await this.identityService.resolveVerifiedProvider(
        {
          provider: 'google',
          providerUserId: claims.sub,
          login,
          ...(claims.name !== undefined && { name: claims.name }),
          email: claims.email,
          emailVerified: true,
          ...(claims.picture !== undefined && { avatarUrl: claims.picture }),
        },
      );

      if (identityResult.kind === 'blocked') {
        return this.withQuery(returnTo, 'auth', identityResult.reason);
      }

      if (identityResult.kind === 'archived') {
        return this.withQuery(returnTo, 'auth', 'archived_choice');
      }

      await this.establishSession(request, identityResult.user);
      await this.saveSession(request);
      await this.outboxRepository.publishLater({
        topic: 'user.signed_in',
        aggregateType: 'user',
        aggregateId: identityResult.user.id,
        payload: {
          provider: 'google',
          login: identityResult.user.login,
        },
      });

      return this.withQuery(returnTo, 'auth', 'success');
    } catch (err) {
      this.logger.error(
        `Google OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withQuery(fallbackReturnTo, 'auth', 'failed');
    }
  }

  /**
   * Archive the authenticated user's account (soft-delete). All child data is
   * preserved via ON DELETE CASCADE being irrelevant here — FK children remain.
   * The session is destroyed after archiving so the user cannot continue using
   * a now-archived account.
   */
  async deleteAccount(request: Request): Promise<void> {
    const userId = request.session.userId ?? request.session.user?.id;
    if (!userId) {
      return;
    }

    // Soft-delete: set archived_at so the row is hidden but recoverable.
    // All child FK rows (projects, subscriptions, etc.) are preserved.
    await this.usersRepository.archiveById(userId);

    // Destroy session after archiving so we don't leave a dangling session
    // pointing at a now-archived user.
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  async logout(request: Request): Promise<void> {
    delete request.session.githubAccessToken;
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        resolve();
      });
    });
  }

  async getSessionUser(request: Request): Promise<SessionUser | null> {
    if (request.session.user) {
      return request.session.user;
    }

    if (!request.session.userId) {
      return null;
    }

    const user = await this.usersRepository.findById(request.session.userId);
    if (user) {
      request.session.user = user;
      request.session.userId = user.id;
    }

    return user;
  }

  async startEmailSignup(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<{ ok: true; verificationRequired: true }> {
    const normalizedEmail = this.normalizeEmail(input.email);
    const displayName = `${input.firstName} ${input.lastName}`.trim();
    const userId = await this.getOrCreatePendingUserId(
      normalizedEmail,
      input.firstName,
      input.lastName,
    );
    const passwordHash = await this.passwordHasher.hash(input.password);

    await this.userIdentitiesRepository.upsertIdentity({
      userId,
      provider: 'email',
      providerUserId: normalizedEmail,
      email: normalizedEmail,
      emailVerified: false,
      passwordHash,
      displayName,
    });

    await this.sendEmailSignupCode(normalizedEmail);
    return { ok: true, verificationRequired: true };
  }

  async verifyEmailSignupCode(
    request: Request,
    input: { email: string; code: string },
  ): Promise<{ ok: true; authenticated: true; user: SessionUser }> {
    const normalizedEmail = this.normalizeEmail(input.email);
    const record = await this.emailVerificationCodesRepository.findLatestActive(
      normalizedEmail,
      'signup',
    );

    if (!record) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const verified = await this.passwordHasher.verify(input.code, record.codeHash);
    if (!verified) {
      await this.emailVerificationCodesRepository.incrementAttempt(record.id);
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const identity = await this.userIdentitiesRepository.findByProviderIdentity(
      'email',
      normalizedEmail,
    );
    if (!identity || identity.archivedAt) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    await this.emailVerificationCodesRepository.consume(record.id);
    await this.userIdentitiesRepository.upsertIdentity({
      userId: identity.userId,
      provider: 'email',
      providerUserId: normalizedEmail,
      email: normalizedEmail,
      emailVerified: true,
      ...(identity.passwordHash !== undefined && {
        passwordHash: identity.passwordHash,
      }),
      ...(identity.displayName !== undefined && {
        displayName: identity.displayName,
      }),
    });

    const user = await this.usersRepository.findById(identity.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.subscriptionsRepository.ensureDefaultFreeSubscription(user.id);
    await this.seedExampleProjectSafelyFor(user.id);
    await this.establishSession(request, user);
    await this.saveSession(request);

    await this.outboxRepository.publishLater({
      topic: 'user.signed_in',
      aggregateType: 'user',
      aggregateId: user.id,
      payload: { provider: 'email', login: user.login },
    });

    return { ok: true, authenticated: true, user };
  }

  async loginWithEmail(
    request: Request,
    input: { email: string; password: string },
  ): Promise<{ ok: true; authenticated: true; user: SessionUser }> {
    const normalizedEmail = this.normalizeEmail(input.email);
    const identity = await this.userIdentitiesRepository.findByProviderIdentity(
      'email',
      normalizedEmail,
    );

    if (
      !identity ||
      identity.archivedAt ||
      !identity.emailVerified ||
      !identity.passwordHash
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordOk = await this.passwordHasher.verify(
      input.password,
      identity.passwordHash,
    );
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.usersRepository.findById(identity.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.establishSession(request, user);
    await this.saveSession(request);

    await this.outboxRepository.publishLater({
      topic: 'user.signed_in',
      aggregateType: 'user',
      aggregateId: user.id,
      payload: { provider: 'email', login: user.login },
    });

    return { ok: true, authenticated: true, user };
  }

  async resendEmailSignupCode(
    email: string,
  ): Promise<{ ok: true; verificationRequired: true }> {
    const normalizedEmail = this.normalizeEmail(email);
    const identity = await this.userIdentitiesRepository.findByProviderIdentity(
      'email',
      normalizedEmail,
    );

    if (identity && !identity.emailVerified && !identity.archivedAt) {
      await this.sendEmailSignupCode(normalizedEmail);
    }

    return { ok: true, verificationRequired: true };
  }
  async completeOnboarding(request: Request): Promise<void> {
    const user = await this.getSessionUser(request);
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    await this.usersRepository.markOnboardingComplete(user.id);
    // Keep the live session object in sync so a subsequent /auth/me call
    // (which may read from request.session.user without a DB round-trip)
    // immediately reflects the completed state.
    if (request.session.user) {
      request.session.user.onboardingCompleted = true;
    }
    await this.saveSession(request);
  }

  /**
   * GET /auth/account/pending
   *
   * Returns information about the archived account that triggered the
   * archived_choice redirect, so the FE can display restore/start-fresh UI.
   * No authentication required — the user is not logged in at this point.
   */
  async getPendingArchivedAccount(
    request: Request,
  ): Promise<PendingAccountInfo | { pending: false }> {
    const pending = request.session.pendingArchived;
    if (!pending) {
      return { pending: false };
    }

    const row = await this.usersRepository.findByGithubUserIdIncludingArchived(
      pending.githubUserId,
    );

    // The row must still be archived (user might have used another tab to
    // restore already). Fall back gracefully.
    const archivedAt = row?.archivedAt ?? null;
    if (!archivedAt) {
      return { pending: false };
    }

    const retentionDays = this.config.archivedAccountRetentionDays;
    const archivedDate = new Date(archivedAt);
    const purgeAt = new Date(archivedDate);
    purgeAt.setDate(purgeAt.getDate() + retentionDays);

    return {
      pending: true,
      login: pending.login,
      archivedAt,
      purgeAt: purgeAt.toISOString(),
      retentionDays,
    };
  }

  /**
   * POST /auth/account/restore
   *
   * Clears archived_at on the pending user's row and establishes a full
   * authenticated session. The pendingArchived payload is cleared afterwards.
   */
  async restoreArchivedAccount(request: Request): Promise<void> {
    const pending = request.session.pendingArchived;
    if (!pending) {
      throw new UnauthorizedException(
        'No pending archived account in this session',
      );
    }

    const restoredUser = await this.usersRepository.restoreByGithubUserId(
      pending.githubUserId,
    );

    await this.establishSession(request, restoredUser);
    request.session.githubAccessToken = pending.accessToken;
    delete request.session.pendingArchived;

    await this.saveSession(request);
  }

  /**
   * POST /auth/account/start-fresh
   *
   * Hard-deletes the old archived row (cascade removes children), then inserts
   * a brand-new active row via upsertGitHubUser (no conflict possible since
   * the old row is gone). Sets up a default free subscription and establishes
   * the session as if the user were signing up for the first time.
   */
  async startFreshAccount(request: Request): Promise<void> {
    const pending = request.session.pendingArchived;
    if (!pending) {
      throw new UnauthorizedException(
        'No pending archived account in this session',
      );
    }

    // Permanently remove the archived row; ON DELETE CASCADE handles children.
    await this.usersRepository.hardDeleteByGithubUserId(pending.githubUserId);

    // Insert a fresh row — no conflict because the old row is gone.
    // onboarding_completed_at is NULL by default so the new account will
    // correctly be directed through the onboarding flow again.
    const newUser = await this.usersRepository.upsertGitHubUser({
      githubUserId: pending.githubUserId,
      login: pending.login,
      ...(pending.name !== undefined && { name: pending.name }),
      ...(pending.email !== undefined && { email: pending.email }),
      ...(pending.avatarUrl !== undefined && { avatarUrl: pending.avatarUrl }),
    });

    await this.subscriptionsRepository.ensureDefaultFreeSubscription(
      newUser.id,
    );
    await this.seedExampleProjectSafelyFor(newUser.id);
    await this.establishSession(request, newUser);
    request.session.githubAccessToken = pending.accessToken;
    delete request.session.pendingArchived;

    await this.saveSession(request);
  }

  private async handleOAuthProviderCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    // Safe fallback used if the DB state lookup itself fails (e.g. transient
    // connection error). Must be defined before the try so the catch can use it.
    const fallbackReturnTo = `${this.config.frontendUrl}/auth/callback`;

    try {
      // Look up and atomically delete the state record from DB.
      // This is the authoritative source — session state is no longer consulted.
      // NOTE: kept inside the outer try so that a transient DB error here produces
      // an auth=failed redirect instead of an unhandled 500.
      const oauthRecord =
        code && state
          ? await this.oauthStateRepository.findAndDelete(state)
          : null;

      // When the state record is missing/expired we have no stored returnTo. Default
      // to the callback page (not the site root) so the FE renders the invalid_state
      // error instead of silently dropping the user on the marketing homepage.
      const returnTo = oauthRecord?.returnTo ?? fallbackReturnTo;

      const isInvalidState =
        !code || !state || oauthRecord?.provider !== 'github';

      if (isInvalidState) {
        return this.withQuery(returnTo, 'auth', 'invalid_state');
      }

      if (!this.hasGitHubCredentials()) {
        return this.withQuery(returnTo, 'auth', 'unavailable');
      }

      const accessToken = await this.exchangeCodeForGitHubToken(code);
      const profile = await this.fetchGitHubUser(accessToken);
      const identityResult = await this.identityService.resolveVerifiedProvider(
        {
          provider: 'github',
          providerUserId: profile.githubUserId,
          login: profile.login,
          ...(profile.name !== undefined && { name: profile.name }),
          ...(profile.email !== undefined && { email: profile.email }),
          emailVerified: profile.emailVerified,
          ...(profile.avatarUrl !== undefined && {
            avatarUrl: profile.avatarUrl,
          }),
        },
      );

      if (identityResult.kind === 'blocked') {
        return this.withQuery(returnTo, 'auth', identityResult.reason);
      }

      if (identityResult.kind === 'archived') {
        // User previously archived their account. Stash a pending-choice
        // payload in the session so the FE can present restore/start-fresh.
        // Do NOT set userId or session.user: the user is NOT authenticated.
        request.session.pendingArchived = {
          provider: identityResult.provider,
          providerUserId: identityResult.providerUserId,
          githubUserId: identityResult.providerUserId,
          login: identityResult.login,
          ...(identityResult.name !== undefined && {
            name: identityResult.name,
          }),
          ...(identityResult.email !== undefined && {
            email: identityResult.email,
          }),
          ...(identityResult.avatarUrl !== undefined && {
            avatarUrl: identityResult.avatarUrl,
          }),
          accessToken,
        };

        await this.saveSession(request);

        return this.withQuery(returnTo, 'auth', 'archived_choice');
      }

      await this.establishSession(request, identityResult.user);
      request.session.githubAccessToken = accessToken;
      // Persist the access token to the store. `session.regenerate()` inside
      // `establishSession` saves userId + user, but subsequent writes to
      // `request.session` after the regenerate promise resolves are NOT
      // automatically flushed with `resave: false`. An explicit save is
      // required to guarantee the token reaches the session store before we
      // redirect the browser.
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
    } catch (err) {
      this.logger.error(
        `OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withQuery(fallbackReturnTo, 'auth', 'failed');
    }
  }

  private async getOrCreatePendingUserId(
    normalizedEmail: string,
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const matches =
      await this.userIdentitiesRepository.findActiveUserIdsByVerifiedEmail(
        normalizedEmail,
      );

    if (matches.length === 1) {
      return matches[0]!;
    }

    if (matches.length > 1) {
      throw new UnauthorizedException('Ambiguous email identity');
    }

    const pendingUser = await this.usersRepository.createFederatedUser({
      login: normalizedEmail.split('@')[0] ?? normalizedEmail,
      name: `${firstName} ${lastName}`.trim(),
      email: normalizedEmail,
      provider: 'email',
    });

    return pendingUser.id;
  }

  private async sendEmailSignupCode(normalizedEmail: string): Promise<void> {
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
  }

  private generateSixDigitCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
  private async seedExampleProjectSafelyFor(userId: string): Promise<void> {
    try {
      await this.exampleProjectSeederService.ensureExampleProjectSeeded(userId);
    } catch (error) {
      this.logger.warn(
        `Example project seeding rejected unexpectedly for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Promisified `request.session.save()`. express-session uses a node-style
   * callback; this wraps it so callers can `await` and so the error-normalizing
   * boilerplate lives in exactly one place.
   */
  private saveSession(request: Request): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      request.session.save((err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve();
      });
    });
  }

  private buildGitHubAuthorizationUrl(state: string): string {
    const authorizationUrl = new URL(
      'https://github.com/login/oauth/authorize',
    );
    authorizationUrl.searchParams.set('client_id', this.config.github.clientId);
    authorizationUrl.searchParams.set(
      'redirect_uri',
      this.config.github.callbackUrl,
    );
    authorizationUrl.searchParams.set('scope', this.config.github.scope);
    authorizationUrl.searchParams.set('state', state);

    return authorizationUrl.toString();
  }

  private async exchangeCodeForGoogleIdToken(code: string): Promise<string> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.config.google!.clientId,
        client_secret: this.config.google!.clientSecret,
        code,
        redirect_uri: this.config.google!.callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange Google OAuth code');
    }

    const payload = (await response.json()) as GoogleTokenResponse;
    if (!payload.id_token || payload.error) {
      throw new Error('Google did not return an ID token');
    }

    return payload.id_token;
  }

  private decodeGoogleIdToken(idToken: string): GoogleIdTokenClaims {
    const [, payload] = idToken.split('.');
    if (!payload) {
      throw new Error('Invalid Google ID token');
    }

    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as GoogleIdTokenClaims;
  }

  private validateGoogleClaims(claims: GoogleIdTokenClaims): void {
    if (claims.aud !== this.config.google!.clientId) {
      throw new Error('Invalid Google audience');
    }

    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) {
      throw new Error('Invalid Google issuer');
    }
  }
  private async exchangeCodeForGitHubToken(code: string): Promise<string> {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: this.config.github.clientId,
          client_secret: this.config.github.clientSecret,
          code,
          redirect_uri: this.config.github.callbackUrl,
        }).toString(),
      },
    );

    if (!response.ok) {
      throw new Error('Failed to exchange OAuth code');
    }

    const payload = (await response.json()) as GitHubTokenResponse;
    if (!payload.access_token || payload.error) {
      throw new Error('GitHub did not return an access token');
    }

    return payload.access_token;
  }

  private async fetchGitHubUser(
    accessToken: string,
  ): Promise<GitHubNormalizedUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cicd-workflow-product',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch GitHub profile');
    }

    const payload = (await response.json()) as GitHubUserResponse;

    let email = payload.email ?? undefined;
    let emailVerified = email !== undefined;

    if (!email) {
      email = await this.fetchPrimaryEmail(accessToken);
      emailVerified = email !== undefined;
    }

    return {
      githubUserId: String(payload.id),
      login: payload.login,
      name: payload.name ?? payload.login,
      ...(payload.avatar_url !== undefined && {
        avatarUrl: payload.avatar_url,
      }),
      ...(email !== undefined && { email }),
      emailVerified,
    };
  }

  private async fetchPrimaryEmail(
    accessToken: string,
  ): Promise<string | undefined> {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cicd-workflow-product',
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as GitHubEmail[];
    const primary =
      payload.find((item) => item.primary && item.verified) ??
      payload.find((item) => item.verified);

    return primary?.email;
  }

  private withQuery(url: string, key: string, value: string): string {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  }

  private normalizeReturnTo(returnTo?: string): string {
    if (!returnTo) {
      return this.config.frontendUrl;
    }

    if (returnTo.startsWith('/')) {
      return `${this.config.frontendUrl}${returnTo}`;
    }

    try {
      const parsed = new URL(returnTo);

      if (this.isAllowedReturnToOrigin(parsed.origin)) {
        return parsed.toString();
      }
    } catch {
      return this.config.frontendUrl;
    }

    return this.config.frontendUrl;
  }

  /**
   * Mirror of the CORS allow-list logic (security.config.ts): an origin is
   * allowed if it is an exact match OR — for HTTPS origins only — matches one of
   * the configured ALLOWED_ORIGIN_PATTERNS. Plain-HTTP origins can never match a
   * pattern, so preview-URL patterns cannot be abused to redirect to http://.
   */
  private isAllowedReturnToOrigin(origin: string): boolean {
    if (this.returnToOrigins.has(origin)) {
      return true;
    }

    if (origin.startsWith('https://')) {
      return this.returnToOriginPatterns.some((re) => re.test(origin));
    }

    return false;
  }

  private buildReturnToOrigins(
    frontendUrl: string,
    allowedOrigins?: string,
  ): Set<string> {
    const origins = new Set<string>();
    this.addReturnToOrigin(origins, frontendUrl);

    for (const origin of (allowedOrigins ?? '').split(',')) {
      this.addReturnToOrigin(origins, origin);
    }

    return origins;
  }

  /**
   * Compile ALLOWED_ORIGIN_PATTERNS into anchored RegExps. Invalid patterns are
   * silently skipped (env validation owns operator feedback), matching the
   * behavior of corsOptions() in security.config.ts so the two allow-lists stay
   * byte-for-byte consistent.
   */
  private buildReturnToOriginPatterns(allowedPatterns?: string): RegExp[] {
    return (allowedPatterns ?? '')
      .split(',')
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0)
      .flatMap((pattern) => {
        try {
          return [new RegExp(`^${pattern}$`)];
        } catch {
          return [];
        }
      });
  }

  private addReturnToOrigin(origins: Set<string>, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed origins; env validation owns operator feedback.
    }
  }

  private async establishSession(
    request: Request,
    user: SessionUser,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        request.session.userId = user.id;
        request.session.user = user;
        delete request.session.oauthState;
        delete request.session.oauthReturnTo;
        delete request.session.oauthProvider;
        delete request.session.pendingArchived;
        resolve();
      });
    });
  }

  private hasGoogleCredentials(): boolean {
    return Boolean(
      this.config.google!.clientId && this.config.google!.clientSecret,
    );
  }

  private hasGitHubCredentials(): boolean {
    return Boolean(
      this.config.github.clientId && this.config.github.clientSecret,
    );
  }
}
