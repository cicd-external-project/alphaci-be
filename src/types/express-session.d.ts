import 'express-session';

import type { SessionUser } from '../common/interfaces/session-user.interface';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    user?: SessionUser;
    oauthState?: string;
    oauthReturnTo?: string;
    oauthProvider?: 'github' | 'google';
    githubAccessToken?: string;
    pendingArchived?: {
      provider?: 'github' | 'google' | 'email';
      providerUserId?: string;
      githubUserId: string;
      login: string;
      name?: string;
      email?: string;
      avatarUrl?: string;
      accessToken: string;
    };
  }
}
