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
  }
}
