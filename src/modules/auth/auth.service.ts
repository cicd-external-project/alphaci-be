import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TribeClient } from '@implementsprint/sdk';

import type { AppConfig } from '../../config/app.config';
import type { SessionUser } from '../../common/interfaces/session-user.interface';
import { OutboxRepository } from '../persistence/outbox.repository';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository';
import { UsersRepository } from '../persistence/users.repository';

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
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
}

interface GoogleNormalizedUser {
  googleUserId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
}

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

type OAuthProvider = 'github' | 'google';

@Injectable()
export class AuthService {
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
    @Optional() @Inject(TribeClient) private readonly apiCenter: TribeClient | null,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
  }

  startGitHubAuth(request: Request, returnTo?: string): string {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasGitHubCredentials()) {
      return this.withQuery(safeReturnTo, 'auth', 'unavailable');
    }

    const state = randomUUID();
    request.session.oauthState = state;
    request.session.oauthReturnTo = safeReturnTo;
    request.session.oauthProvider = 'github';

    return this.buildGitHubAuthorizationUrl(state);
  }

  async startGoogleAuth(request: Request, returnTo?: string): Promise<string> {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasGoogleCredentials()) {
      return this.withQuery(safeReturnTo, 'auth', 'unavailable');
    }

    const state = randomUUID();
    request.session.oauthState = state;
    request.session.oauthReturnTo = safeReturnTo;
    request.session.oauthProvider = 'google';

    const { authorizationUrl } = await this.apiCenter!.gauthGetAuthorizationUrl({
      redirectUri: this.config.google.callbackUrl,
      state,
      scopes: this.config.google.scope.split(' '),
      accessType: 'offline',
      prompt: 'select_account',
    });

    return authorizationUrl;
  }

  async handleGitHubCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    return this.handleOAuthProviderCallback(request, 'github', code, state);
  }

  async handleGoogleCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    return this.handleOAuthProviderCallback(request, 'google', code, state);
  }

  async logout(request: Request): Promise<void> {
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

  private async handleOAuthProviderCallback(
    request: Request,
    provider: OAuthProvider,
    code?: string,
    state?: string,
  ): Promise<string> {
    const returnTo = request.session.oauthReturnTo ?? this.config.frontendUrl;

    const isInvalidState =
      !code ||
      !state ||
      state !== request.session.oauthState ||
      request.session.oauthProvider !== provider;

    if (isInvalidState) {
      delete request.session.oauthState;
      delete request.session.oauthReturnTo;
      delete request.session.oauthProvider;
      return this.withQuery(returnTo, 'auth', 'invalid_state');
    }

    const hasCredentials =
      provider === 'github'
        ? this.hasGitHubCredentials()
        : this.hasGoogleCredentials();

    if (!hasCredentials) {
      return this.withQuery(returnTo, 'auth', 'unavailable');
    }

    try {
      let persistedUser: SessionUser;
      if (provider === 'github') {
        const result = await this.signInWithGitHubAndReturnToken(code);
        persistedUser = result.user;
        await this.subscriptionsRepository.ensureDefaultFreeSubscription(
          persistedUser.id,
        );
        await this.establishSession(request, persistedUser);
        request.session.githubAccessToken = result.accessToken;
      } else {
        persistedUser = await this.signInWithGoogle(code);
        await this.subscriptionsRepository.ensureDefaultFreeSubscription(
          persistedUser.id,
        );
        await this.establishSession(request, persistedUser);
      }

      await this.outboxRepository.publishLater({
        topic: 'user.signed_in',
        aggregateType: 'user',
        aggregateId: persistedUser.id,
        payload: {
          provider,
          login: persistedUser.login,
        },
      });

      return this.withQuery(returnTo, 'auth', 'success');
    } catch {
      return this.withQuery(returnTo, 'auth', 'failed');
    }
  }

  private async signInWithGitHubAndReturnToken(
    code: string,
  ): Promise<{ user: SessionUser; accessToken: string }> {
    const accessToken = await this.exchangeCodeForGitHubToken(code);
    const profile = await this.fetchGitHubUser(accessToken);
    const user = await this.usersRepository.upsertGitHubUser(profile);
    return { user, accessToken };
  }

  private async signInWithGoogle(code: string): Promise<SessionUser> {
    const tokens = await this.apiCenter!.gauthExchangeCode({
      code,
      redirectUri: this.config.google.callbackUrl,
    });

    const profile = await this.verifyAndDecodeGoogleIdToken(tokens.idToken ?? '');
    return this.usersRepository.upsertGoogleUser(profile);
  }

  /**
   * Verify a Google ID token and extract its claims.
   *
   * Verification strategy: call Google's tokeninfo endpoint
   * (https://oauth2.googleapis.com/tokeninfo?id_token=TOKEN). Google's servers
   * perform full signature, expiry, issuer, and audience verification before
   * returning claims. This avoids the need for a local JWKS cache and is the
   * recommended approach when google-auth-library / jose are not available.
   *
   * Security properties guaranteed by the tokeninfo endpoint:
   *  - RS256 signature checked against Google's published public keys
   *  - `exp` claim verified (token not expired)
   *  - `iss` must be accounts.google.com or https://accounts.google.com
   *  - `aud` must match a registered Google OAuth client
   *
   * Note: one extra network round-trip per sign-in. Acceptable for an
   * interactive OAuth callback. If latency becomes a concern, swap to
   * google-auth-library (OAuth2Client.verifyIdToken).
   */
  private async verifyAndDecodeGoogleIdToken(
    idToken: string,
  ): Promise<GoogleNormalizedUser> {
    if (!idToken) {
      throw new Error('Google ID token is missing from exchange response');
    }

    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('id_token', idToken);

    const response = await fetch(url.toString());

    if (!response.ok) {
      // 400 means the token is invalid or expired; any other non-2xx is a
      // transient Google-side error. Treat both as verification failures.
      throw new Error(
        `Google ID token verification failed (tokeninfo HTTP ${String(response.status)})`,
      );
    }

    const claims = (await response.json()) as GoogleIdTokenClaims & {
      aud?: string;
      iss?: string;
      exp?: string;
    };

    if (!claims.sub) {
      throw new Error('Google ID token missing subject claim');
    }

    // Validate audience against configured client ID if available.
    // This prevents tokens issued to a different OAuth client from being
    // accepted (confused-deputy attack).
    const expectedAud = this.config.google.clientId;
    if (expectedAud && claims.aud !== expectedAud) {
      throw new Error(
        'Google ID token audience does not match configured client ID',
      );
    }

    if (claims.email && claims.email_verified === false) {
      throw new Error('Google account email is not verified');
    }

    const fallbackLogin = `google-${claims.sub}`;
    const loginSeed = claims.email
      ? (claims.email.split('@')[0] ?? fallbackLogin)
      : fallbackLogin;

    return {
      googleUserId: claims.sub,
      login: this.normalizeLogin(loginSeed),
      name: claims.name ?? claims.given_name ?? 'Google User',
      ...(claims.picture !== undefined && { avatarUrl: claims.picture }),
      ...(claims.email !== undefined && { email: claims.email }),
    };
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

    let email = payload.email;
    if (!email) {
      email = await this.fetchPrimaryEmail(accessToken);
    }

    return {
      githubUserId: String(payload.id),
      login: payload.login,
      name: payload.name ?? payload.login,
      ...(payload.avatar_url !== undefined && {
        avatarUrl: payload.avatar_url,
      }),
      ...(email !== undefined && { email }),
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
      const frontend = new URL(this.config.frontendUrl);

      if (parsed.origin === frontend.origin) {
        return parsed.toString();
      }
    } catch {
      return this.config.frontendUrl;
    }

    return this.config.frontendUrl;
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
        resolve();
      });
    });
  }

  private normalizeLogin(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-+|-+$/g, '');

    if (normalized) {
      return normalized;
    }

    return `user-${randomUUID().slice(0, 8)}`;
  }

  private hasGitHubCredentials(): boolean {
    return Boolean(
      this.config.github.clientId && this.config.github.clientSecret,
    );
  }

  private hasGoogleCredentials(): boolean {
    return this.apiCenter !== null;
  }
}
