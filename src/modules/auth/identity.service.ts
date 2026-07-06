import { Injectable } from '@nestjs/common';

import { ExampleProjectSeederService } from '../projects/example-project-seeder.service';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository';
import { UsersRepository } from '../persistence/users.repository';
import type {
  IdentityResolution,
  VerifiedProviderProfile,
} from './identity.types';

@Injectable()
export class IdentityService {
  constructor(
    private readonly identitiesRepository: UserIdentitiesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly exampleProjectSeederService: ExampleProjectSeederService,
  ) {}

  async listForUser(userId: string): Promise<{
    methods: Array<{
      provider: 'email' | 'google' | 'github';
      email?: string;
      emailVerified: boolean;
    }>;
  }> {
    return {
      methods: await this.identitiesRepository.listForUser(userId),
    };
  }

  async resolveVerifiedProvider(
    profile: VerifiedProviderProfile,
  ): Promise<IdentityResolution> {
    const existingIdentity =
      await this.identitiesRepository.findByProviderIdentity(
        profile.provider,
        profile.providerUserId,
      );

    if (existingIdentity) {
      if (existingIdentity.archivedAt) {
        return this.toArchived(profile);
      }

      const user = await this.usersRepository.findById(
        existingIdentity.userId,
      );
      if (!user) {
        return { kind: 'blocked', reason: 'ambiguous_identity' };
      }

      await this.linkIdentity(user.id, profile);
      return { kind: 'active', user, isNewUser: false };
    }

    if (profile.provider === 'github') {
      const legacy =
        await this.usersRepository.findByGithubUserIdIncludingArchived(
          profile.providerUserId,
        );

      if (legacy) {
        if (legacy.archivedAt) {
          return this.toArchived(profile);
        }

        const user = await this.usersRepository.findById(legacy.id);
        if (!user) {
          return { kind: 'blocked', reason: 'ambiguous_identity' };
        }

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

    const matchedUserIds =
      await this.identitiesRepository.findActiveUserIdsByVerifiedEmail(
        profile.email,
      );

    if (matchedUserIds.length > 1) {
      return { kind: 'blocked', reason: 'ambiguous_identity' };
    }

    if (matchedUserIds.length === 1) {
      const user = await this.usersRepository.findById(matchedUserIds[0]!);
      if (!user) {
        return { kind: 'blocked', reason: 'ambiguous_identity' };
      }

      await this.linkIdentity(user.id, profile);
      return { kind: 'active', user, isNewUser: false };
    }

    const user = await this.usersRepository.createFederatedUser({
      login: profile.login,
      ...(profile.name !== undefined && { name: profile.name }),
      email: profile.email,
      ...(profile.avatarUrl !== undefined && { avatarUrl: profile.avatarUrl }),
      provider: profile.provider,
    });

    await this.linkIdentity(user.id, profile);
    await this.subscriptionsRepository.ensureDefaultFreeSubscription(user.id);
    await this.seedExampleProjectSafelyFor(user.id);

    return { kind: 'active', user, isNewUser: true };
  }

  private async linkIdentity(
    userId: string,
    profile: VerifiedProviderProfile,
  ): Promise<void> {
    await this.identitiesRepository.upsertIdentity({
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      ...(profile.email !== undefined && { email: profile.email }),
      emailVerified: profile.emailVerified,
      ...(profile.name !== undefined && { displayName: profile.name }),
      ...(profile.avatarUrl !== undefined && { avatarUrl: profile.avatarUrl }),
    });
  }

  private toArchived(profile: VerifiedProviderProfile): IdentityResolution {
    return {
      kind: 'archived',
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      login: profile.login,
      ...(profile.email !== undefined && { email: profile.email }),
      ...(profile.name !== undefined && { name: profile.name }),
      ...(profile.avatarUrl !== undefined && { avatarUrl: profile.avatarUrl }),
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
