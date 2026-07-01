import { BadRequestException } from '@nestjs/common';

import { ProvisioningJobsRepository } from './provisioning-jobs.repository';

describe('ProvisioningJobsRepository', () => {
  const databaseService = {
    query: jest.fn(),
  };

  let repository: ProvisioningJobsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ProvisioningJobsRepository(databaseService as never);
  });

  it('creates or returns an existing job by idempotency key', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeJobRow({
          id: 'job-1',
          idempotency_key: 'workspace-1:project-1:deploy:api:dev',
          job_type: 'deploy_revision',
        }),
      ],
    });

    const job = await repository.createJob({
      jobType: 'deploy_revision',
      idempotencyKey: 'workspace-1:project-1:deploy:api:dev',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      deploymentTargetId: 'target-1',
      payload: { imageDigest: 'sha256:abc' },
      maxAttempts: 3,
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (idempotency_key)'),
      expect.arrayContaining([
        'deploy_revision',
        'workspace-1:project-1:deploy:api:dev',
        'workspace-1',
        'project-1',
        'target-1',
        3,
        JSON.stringify({ imageDigest: 'sha256:abc' }),
      ]),
    );
    expect(job).toEqual(
      expect.objectContaining({
        id: 'job-1',
        jobType: 'deploy_revision',
        idempotencyKey: 'workspace-1:project-1:deploy:api:dev',
      }),
    );
  });

  it('rejects missing idempotency keys before querying', async () => {
    await expect(
      repository.createJob({
        jobType: 'deploy_revision',
        idempotencyKey: '',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        payload: {},
      }),
    ).rejects.toThrow(BadRequestException);

    expect(databaseService.query).not.toHaveBeenCalled();
  });

  it('claims the next queued job with a worker lock and attempt increment', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeJobRow({
          id: 'job-1',
          status: 'running',
          locked_by: 'worker-1',
          attempt_count: 1,
        }),
      ],
    });

    const job = await repository.claimNextJob('worker-1', [
      'provision_target',
      'deploy_revision',
    ]);

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      ['worker-1', ['provision_target', 'deploy_revision']],
    );
    expect(job).toEqual(
      expect.objectContaining({
        id: 'job-1',
        status: 'running',
        lockedBy: 'worker-1',
        attemptCount: 1,
      }),
    );
  });

  it('stores only safe retryable failure details and dead-letters exhausted jobs', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [
        makeJobRow({
          id: 'job-1',
          status: 'dead_letter',
          attempt_count: 3,
          max_attempts: 3,
          safe_error_code: 'GCP_DEPLOY_FAILED',
          safe_error_message: 'Cloud Run deployment failed',
          dead_letter_reason: 'max_attempts_exhausted',
        }),
      ],
    });

    const job = await repository.markRetryableFailure('job-1', {
      code: 'GCP_DEPLOY_FAILED',
      safeMessage: 'Cloud Run deployment failed',
      nextRetryAt: '2026-07-01T12:00:00.000Z',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('max_attempts_exhausted'),
      [
        'job-1',
        'GCP_DEPLOY_FAILED',
        'Cloud Run deployment failed',
        '2026-07-01T12:00:00.000Z',
      ],
    );
    expect(JSON.stringify(databaseService.query.mock.calls[0])).not.toContain(
      'raw',
    );
    expect(job).toEqual(
      expect.objectContaining({
        status: 'dead_letter',
        safeErrorCode: 'GCP_DEPLOY_FAILED',
        safeErrorMessage: 'Cloud Run deployment failed',
        deadLetterReason: 'max_attempts_exhausted',
      }),
    );
  });
});

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    job_type: 'deploy_revision',
    idempotency_key: 'workspace-1:project-1:deploy:api:dev',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    deployment_target_id: 'target-1',
    status: 'queued',
    attempt_count: 0,
    max_attempts: 5,
    locked_at: null,
    locked_by: null,
    next_retry_at: null,
    dead_letter_reason: null,
    safe_error_code: null,
    safe_error_message: null,
    payload: {},
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}
