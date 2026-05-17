import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { SessionAuthGuard } from './session-auth.guard.js';
import { UsersRepository } from '../../modules/persistence/users.repository.js';
import type { ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '../interfaces/session-user.interface.js';

const fakeUser: SessionUser = { id: 'user-1', login: 'testuser' };

const makeContext = (session: Record<string, unknown>) => ({
  switchToHttp: () => ({
    getRequest: () => ({ session }),
  }),
}) as unknown as ExecutionContext;

const makeUsersRepo = () =>
  ({
    findById: jest.fn().mockResolvedValue(fakeUser),
  }) as unknown as UsersRepository;

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let usersRepo: UsersRepository;

  beforeEach(async () => {
    usersRepo = makeUsersRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionAuthGuard,
        { provide: UsersRepository, useValue: usersRepo },
      ],
    }).compile();

    guard = module.get(SessionAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('returns true when session.user is set', async () => {
    const ctx = makeContext({ user: fakeUser });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when session has neither user nor userId', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('loads user from repo when userId is set but user is missing', async () => {
    const session: Record<string, unknown> = { userId: 'user-1' };
    const ctx = makeContext(session);
    const result = await guard.canActivate(ctx);

    expect(usersRepo.findById).toHaveBeenCalledWith('user-1');
    expect(result).toBe(true);
    expect(session['user']).toEqual(fakeUser);
  });

  it('throws UnauthorizedException when userId is set but user not found in repo', async () => {
    (usersRepo.findById as jest.Mock).mockResolvedValueOnce(null);
    const ctx = makeContext({ userId: 'unknown' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
