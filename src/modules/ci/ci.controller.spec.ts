import { UnauthorizedException } from '@nestjs/common';

import { CiController } from './ci.controller';
import { CiService } from './ci.service';

const makeService = () =>
  ({
    validateRun: jest.fn().mockResolvedValue({
      authorized: true,
      projectId: 'project-1',
      repoFullName: 'owner/repo',
      stage: 'quality',
    }),
  }) as unknown as CiService;

describe('CiController', () => {
  let service: CiService;
  let controller: CiController;

  beforeEach(() => {
    service = makeService();
    controller = new CiController(service);
  });

  it('validates a bearer token against repo and stage metadata', async () => {
    const result = await controller.validate(
      'Bearer fci_valid-token',
      {
        repo: 'owner/repo',
        stage: 'quality',
        workflowRunId: '12345',
        headSha: 'abc123',
      },
    );

    expect(service.validateRun).toHaveBeenCalledWith({
      token: 'fci_valid-token',
      repoFullName: 'owner/repo',
      stage: 'quality',
      workflowRunId: '12345',
      headSha: 'abc123',
    });
    expect(result.authorized).toBe(true);
  });

  it('rejects requests without a bearer token', async () => {
    await expect(
      controller.validate(undefined, { repo: 'owner/repo', stage: 'gate' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
