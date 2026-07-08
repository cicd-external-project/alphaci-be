import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { CiService } from './ci.service';
import type { CiTokensRepository } from './ci-tokens.repository';

const makeRepository = () =>
  ({
    upsertProjectToken: jest.fn(),
    findValidationContext: jest.fn(),
    revokeProjectTokens: jest.fn(),
  }) as unknown as CiTokensRepository;

describe('CiService', () => {
  let repository: CiTokensRepository;
  let service: CiService;

  beforeEach(() => {
    repository = makeRepository();
    service = new CiService(repository);
  });

  it('issues an opaque project token and persists only its hash', async () => {
    (repository.upsertProjectToken as jest.Mock).mockResolvedValueOnce(
      undefined,
    );

    const result = await service.issueProjectToken('project-1');

    expect(result.token).toMatch(/^aci_[A-Za-z0-9_-]{32,}$/);
    expect(result.tokenPrefix).toBe(result.token.slice(0, 12));
    expect(repository.upsertProjectToken).toHaveBeenCalledWith({
      projectId: 'project-1',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tokenPrefix: result.tokenPrefix,
    });
    expect(repository.upsertProjectToken).not.toHaveBeenCalledWith(
      expect.objectContaining({ token: result.token }),
    );
  });

  it('validates an active token for a provisioned project and repo', async () => {
    (repository.findValidationContext as jest.Mock).mockResolvedValueOnce({
      project_id: 'project-1',
      user_id: 'user-1',
      repo_full_name: 'owner/repo',
      project_status: 'provisioned',
      token_status: 'active',
      subscription_status: 'active',
    });

    const result = await service.validateRun({
      token: 'aci_valid-token',
      repoFullName: 'owner/repo',
      stage: 'quality',
    });

    expect(result).toEqual({
      authorized: true,
      projectId: 'project-1',
      repoFullName: 'owner/repo',
      stage: 'quality',
    });
  });

  it('rejects a missing bearer token', async () => {
    await expect(
      service.validateRun({
        token: '',
        repoFullName: 'owner/repo',
        stage: 'gate',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token that does not match the repo', async () => {
    (repository.findValidationContext as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.validateRun({
        token: 'aci_valid-token',
        repoFullName: 'other/repo',
        stage: 'quality',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects inactive subscriptions', async () => {
    (repository.findValidationContext as jest.Mock).mockResolvedValueOnce({
      project_id: 'project-1',
      user_id: 'user-1',
      repo_full_name: 'owner/repo',
      project_status: 'provisioned',
      token_status: 'active',
      subscription_status: 'inactive',
    });

    await expect(
      service.validateRun({
        token: 'aci_valid-token',
        repoFullName: 'owner/repo',
        stage: 'quality',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
