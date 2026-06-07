import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '../../config/app.config';
import type { SessionUser } from '../../common/interfaces/session-user.interface';
import { OAuthStateRepository } from '../persistence/oauth-state.repository';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly oauthStateRepository: OAuthStateRepository,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
  }

  async startGitHubAuth(request: Request, returnTo?: string): Promise<string> {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasGitHubCredentials()) {
      return this.withQuery(safeReturnTo, 'auth', 'unavailable');
    }

    const state = randomUUID();

    // Store OAuth state in DB — eliminates the session cookie dependency for
    // state verification. The cookie race condition on cold starts is moot
    // because state lives in Supabase, not the session store.
    await this.oauthStateRepository.save(state, safeReturnTo, 'github');

    // Probabilistic cleanup: prune expired rows on ~5% of login starts.
    // This keeps the table lean without adding a cron dependency. The prune
    // is fire-and-forget (errors are caught inside pruneExpired) so it never
    // blocks or fails the login flow.
    if (Math.random() < 0.05) {
      void this.oauthStateRepository.pruneExpired();
    }

    return this.buildGitHubAuthorizationUrl(state);
  }

  async handleGitHubCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    return this.handleOAuthProviderCallback(request, code, state);
  }

  async deleteAccount(request: Request): Promise<void> {
    const userId = request.session.userId ?? request.session.user?.id;
    if (!userId) {
      return;
    }

    // Hard-delete all user data in FK-safe order, then destroy the session.
    // provisioned_projects, user_subscriptions, workflow_generations,
    // outbox_events, and oauth_states all reference app_users by user_id
    // with ON DELETE CASCADE — a single DELETE on app_users is sufficient.
    // The session row is cleaned up by destroying the session below.
    await this.usersRepository.deleteById(userId);

    // Destroy session after data deletion so we don't leave a dangling session
    // pointing at a now-deleted user.
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

  private async handleOAuthProviderCallback(
    request: Request,
    code?: string,
    state?: string,
  ): Promise<string> {
    // Look up and atomically delete the state record from DB.
    // This is the authoritative source — session state is no longer consulted.
    const oauthRecord =
      code && state
        ? await this.oauthStateRepository.findAndDelete(state)
        : null;

    const returnTo = oauthRecord?.returnTo ?? this.config.frontendUrl;

    const isInvalidState =
      !code || !state || oauthRecord?.provider !== 'github';

    if (isInvalidState) {
      return this.withQuery(returnTo, 'auth', 'invalid_state');
    }

    if (!this.hasGitHubCredentials()) {
      return this.withQuery(returnTo, 'auth', 'unavailable');
    }

    try {
      const result = await this.signInWithGitHubAndReturnToken(code);
      const persistedUser = result.user;
      await this.subscriptionsRepository.ensureDefaultFreeSubscription(
        persistedUser.id,
      );
      await this.establishSession(request, persistedUser);
      request.session.githubAccessToken = result.accessToken;
      // Persist the access token to the store. `session.regenerate()` inside
      // `establishSession` saves userId + user, but subsequent writes to
      // `request.session` after the regenerate promise resolves are NOT
      // automatically flushed with `resave: false`. An explicit save is
      // required to guarantee the token reaches the session store before we
      // redirect the browser.
      await new Promise<void>((resolve, reject) => {
        request.session.save((err) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          resolve();
        });
      });

      await this.outboxRepository.publishLater({
        topic: 'user.signed_in',
        aggregateType: 'user',
        aggregateId: persistedUser.id,
        payload: {
          provider: 'github',
          login: persistedUser.login,
        },
      });

      return this.withQuery(returnTo, 'auth', 'success');
    } catch (err) {
      this.logger.error(
        `OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
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
}
