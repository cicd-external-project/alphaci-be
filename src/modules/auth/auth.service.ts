import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import type { AppConfig } from "../../config/app.config";
import type { SessionUser } from "../../common/interfaces/session-user.interface";
import { OutboxRepository } from "../persistence/outbox.repository";
import { SubscriptionsRepository } from "../persistence/subscriptions.repository";
import { UsersRepository } from "../persistence/users.repository";

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

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleUserResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

interface GoogleNormalizedUser {
  googleUserId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
}

type OAuthProvider = "github" | "google";

@Injectable()
export class AuthService {
  private readonly config: AppConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly outboxRepository: OutboxRepository,
  ) {
    this.config = this.configService.getOrThrow<AppConfig>("app");
  }

  startGitHubAuth(request: Request, returnTo?: string): string {
    return this.startOAuthProviderAuth(request, "github", returnTo);
  }

  startGoogleAuth(request: Request, returnTo?: string): string {
    return this.startOAuthProviderAuth(request, "google", returnTo);
  }

  async handleGitHubCallback(request: Request, code?: string, state?: string): Promise<string> {
    return this.handleOAuthProviderCallback(request, "github", code, state);
  }

  async handleGoogleCallback(request: Request, code?: string, state?: string): Promise<string> {
    return this.handleOAuthProviderCallback(request, "google", code, state);
  }

  async logout(request: Request): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(error);
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

  private startOAuthProviderAuth(request: Request, provider: OAuthProvider, returnTo?: string): string {
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    if (!this.hasProviderCredentials(provider)) {
      return this.withQuery(safeReturnTo, "auth", "unavailable");
    }

    const state = randomUUID();
    request.session.oauthState = state;
    request.session.oauthReturnTo = safeReturnTo;
    request.session.oauthProvider = provider;

    if (provider === "github") {
      return this.buildGitHubAuthorizationUrl(state);
    }

    return this.buildGoogleAuthorizationUrl(state);
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
      request.session.oauthState = undefined;
      request.session.oauthReturnTo = undefined;
      request.session.oauthProvider = undefined;
      return this.withQuery(returnTo, "auth", "invalid_state");
    }

    if (!this.hasProviderCredentials(provider)) {
      return this.withQuery(returnTo, "auth", "unavailable");
    }

    try {
      let persistedUser: SessionUser;
      if (provider === "github") {
        const result = await this.signInWithGitHubAndReturnToken(code);
        persistedUser = result.user;
        await this.subscriptionsRepository.ensureDefaultFreeSubscription(persistedUser.id);
        await this.establishSession(request, persistedUser);
        request.session.githubAccessToken = result.accessToken;
      } else {
        persistedUser = await this.signInWithGoogle(code);
        await this.subscriptionsRepository.ensureDefaultFreeSubscription(persistedUser.id);
        await this.establishSession(request, persistedUser);
      }

      await this.outboxRepository.publishLater({
        topic: "user.signed_in",
        aggregateType: "user",
        aggregateId: persistedUser.id,
        payload: {
          provider,
          login: persistedUser.login,
        },
      });

      return this.withQuery(returnTo, "auth", "success");
    } catch {
      return this.withQuery(returnTo, "auth", "failed");
    }
  }

  private async signInWithGitHub(code: string): Promise<SessionUser> {
    const token = await this.exchangeCodeForGitHubToken(code);
    const profile = await this.fetchGitHubUser(token);

    return this.usersRepository.upsertGitHubUser(profile);
  }

  private async signInWithGitHubAndReturnToken(code: string): Promise<{ user: SessionUser; accessToken: string }> {
    const accessToken = await this.exchangeCodeForGitHubToken(code);
    const profile = await this.fetchGitHubUser(accessToken);
    const user = await this.usersRepository.upsertGitHubUser(profile);
    return { user, accessToken };
  }

  private async signInWithGoogle(code: string): Promise<SessionUser> {
    const token = await this.exchangeCodeForGoogleToken(code);
    const profile = await this.fetchGoogleUser(token);

    return this.usersRepository.upsertGoogleUser(profile);
  }

  private buildGitHubAuthorizationUrl(state: string): string {
    const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
    authorizationUrl.searchParams.set("client_id", this.config.github.clientId);
    authorizationUrl.searchParams.set("redirect_uri", this.config.github.callbackUrl);
    authorizationUrl.searchParams.set("scope", this.config.github.scope);
    authorizationUrl.searchParams.set("state", state);

    return authorizationUrl.toString();
  }

  private buildGoogleAuthorizationUrl(state: string): string {
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", this.config.google.clientId);
    authorizationUrl.searchParams.set("redirect_uri", this.config.google.callbackUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", this.config.google.scope);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("prompt", "select_account");

    return authorizationUrl.toString();
  }

  private async exchangeCodeForGitHubToken(code: string): Promise<string> {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.config.github.clientId,
        client_secret: this.config.github.clientSecret,
        code,
        redirect_uri: this.config.github.callbackUrl,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange OAuth code");
    }

    const payload = (await response.json()) as GitHubTokenResponse;
    if (!payload.access_token || payload.error) {
      throw new Error("GitHub did not return an access token");
    }

    return payload.access_token;
  }

  private async exchangeCodeForGoogleToken(code: string): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.config.google.clientId,
        client_secret: this.config.google.clientSecret,
        code,
        redirect_uri: this.config.google.callbackUrl,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange Google OAuth code");
    }

    const payload = (await response.json()) as GoogleTokenResponse;
    if (!payload.access_token || payload.error) {
      throw new Error("Google did not return an access token");
    }

    return payload.access_token;
  }

  private async fetchGitHubUser(accessToken: string): Promise<GitHubNormalizedUser> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cicd-workflow-product",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch GitHub profile");
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
      avatarUrl: payload.avatar_url ?? undefined,
      email,
    };
  }

  private async fetchGoogleUser(accessToken: string): Promise<GoogleNormalizedUser> {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch Google profile");
    }

    const payload = (await response.json()) as GoogleUserResponse;
    if (!payload.sub) {
      throw new Error("Google profile did not include a subject");
    }

    if (payload.email && payload.email_verified === false) {
      throw new Error("Google account email is not verified");
    }

    const fallbackLogin = `google-${payload.sub}`;
    const loginSeed = payload.email ? payload.email.split("@")[0] || fallbackLogin : fallbackLogin;

    return {
      googleUserId: payload.sub,
      login: this.normalizeLogin(loginSeed),
      name: payload.name ?? payload.given_name ?? "Google User",
      avatarUrl: payload.picture ?? undefined,
      email: payload.email,
    };
  }

  private async fetchPrimaryEmail(accessToken: string): Promise<string | undefined> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cicd-workflow-product",
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as GitHubEmail[];
    const primary = payload.find((item) => item.primary && item.verified) ?? payload.find((item) => item.verified);

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

    if (returnTo.startsWith("/")) {
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

  private async establishSession(request: Request, user: SessionUser): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        request.session.userId = user.id;
        request.session.user = user;
        request.session.oauthState = undefined;
        request.session.oauthReturnTo = undefined;
        request.session.oauthProvider = undefined;
        resolve();
      });
    });
  }

  private normalizeLogin(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-+|-+$/g, "");

    if (normalized) {
      return normalized;
    }

    return `user-${randomUUID().slice(0, 8)}`;
  }

  private hasProviderCredentials(provider: OAuthProvider): boolean {
    return provider === "github" ? this.hasGitHubCredentials() : this.hasGoogleCredentials();
  }

  private hasGitHubCredentials(): boolean {
    return Boolean(this.config.github.clientId && this.config.github.clientSecret);
  }

  private hasGoogleCredentials(): boolean {
    return Boolean(this.config.google.clientId && this.config.google.clientSecret);
  }
}
