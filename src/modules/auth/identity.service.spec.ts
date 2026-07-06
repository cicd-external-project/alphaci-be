import { ExampleProjectSeederService } from '../projects/example-project-seeder.service.js';
import { SubscriptionsRepository } from '../persistence/subscriptions.repository.js';
import { UserIdentitiesRepository } from '../persistence/user-identities.repository.js';
import { UsersRepository } from '../persistence/users.repository.js';
import { IdentityService } from './identity.service.js';

const user = {
  id: 'user-1',
  login: 'tone',
  email: 'tone@example.test',
  onboardingCompleted: false,
};

function makeService(
  overrides: {
    identities?: Partial<UserIdentitiesRepository>;
    users?: Partial<UsersRepository>;
  } = {},
) {
  const identities = {
    findByProviderIdentity: jest.fn().mockResolvedValue(null),
    findActiveUserIdsByVerifiedEmail: jest.fn().mockResolvedValue([]),
    listForUser: jest.fn().mockResolvedValue([]),
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
  it('lists connected identities for a user', async () => {
    const { service, identities } = makeService({
      identities: {
        listForUser: jest.fn().mockResolvedValue([
          {
            provider: 'github',
            email: 'tone@example.test',
            emailVerified: true,
          },
        ]),
      },
    });

    await expect(service.listForUser('user-1')).resolves.toEqual({
      methods: [
        { provider: 'github', email: 'tone@example.test', emailVerified: true },
      ],
    });
    expect(identities.listForUser).toHaveBeenCalledWith('user-1');
  });
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
        findActiveUserIdsByVerifiedEmail: jest
          .fn()
          .mockResolvedValue(['user-1']),
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
      expect.objectContaining({
        login: 'tone',
        email: 'tone@example.test',
      }),
    );
    expect(subscriptions.ensureDefaultFreeSubscription).toHaveBeenCalledWith(
      'user-1',
    );
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
    expect(users.findByGithubUserIdIncludingArchived).toHaveBeenCalledWith(
      '123',
    );
  });
});
