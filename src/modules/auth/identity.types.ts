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
  | {
      kind: 'archived';
      provider: IdentityProvider;
      providerUserId: string;
      login: string;
      email?: string;
      name?: string;
      avatarUrl?: string;
    }
  | {
      kind: 'blocked';
      reason: 'email_required' | 'email_unverified' | 'ambiguous_identity';
    };
