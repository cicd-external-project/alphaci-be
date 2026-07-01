import { BadRequestException } from '@nestjs/common';

import { PreviewCleanupService } from './preview-cleanup.service';

describe('PreviewCleanupService', () => {
  const service = new PreviewCleanupService();

  it('plans cleanup for a closed pull request without deleting live resources', () => {
    const plan = service.planCleanup({
      previewId: 'preview-1',
      cloudRunServiceName: 'ac-customer-alpha-pr-42-web',
      previewDomain: 'pr-42-alpha-customer.itsandbox.site',
      imageTags: ['pr-42-abcdef1'],
      secretVersionNames: ['projects/p/secrets/preview-db/versions/3'],
      labels: {
        environment: 'preview',
        pullRequestNumber: '42',
        projectId: 'project-1',
      },
      reason: 'pull_request_closed',
    });

    expect(plan.cleanupStatus).toBe('cleanup_required');
    expect(plan.resourcesToDelete).toEqual({
      cloudRunServices: ['ac-customer-alpha-pr-42-web'],
      domainRecords: ['pr-42-alpha-customer.itsandbox.site'],
      imageTags: ['pr-42-abcdef1'],
      secretVersions: ['projects/p/secrets/preview-db/versions/3'],
    });
    expect(plan.liveMutationAllowed).toBe(false);
  });

  it('refuses cleanup when labels do not prove the service is a preview', () => {
    expect(() =>
      service.planCleanup({
        previewId: 'preview-1',
        cloudRunServiceName: 'orders-api-prod',
        previewDomain: 'orders-api.itsandbox.site',
        imageTags: [],
        secretVersionNames: [],
        labels: {
          environment: 'prod',
          projectId: 'project-1',
        },
        reason: 'ttl_expired',
      }),
    ).toThrow(BadRequestException);
  });

  it('selects expired previews for cleanup and ignores active ones', () => {
    const now = new Date('2026-07-02T00:00:00.000Z');

    const selected = service.selectCleanupCandidates(
      [
        {
          previewId: 'expired',
          lifecycleStatus: 'healthy',
          cleanupStatus: 'none',
          expiresAt: '2026-07-01T00:00:00.000Z',
        },
        {
          previewId: 'active',
          lifecycleStatus: 'healthy',
          cleanupStatus: 'none',
          expiresAt: '2026-07-03T00:00:00.000Z',
        },
        {
          previewId: 'closed',
          lifecycleStatus: 'cleanup_required',
          cleanupStatus: 'pending',
          expiresAt: '2026-07-03T00:00:00.000Z',
        },
      ],
      now,
    );

    expect(selected.map((preview) => preview.previewId)).toEqual([
      'expired',
      'closed',
    ]);
  });
});
