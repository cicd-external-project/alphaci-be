import { BadRequestException } from '@nestjs/common';

import { PreviewLimitsService } from './preview-limits.service';

describe('PreviewLimitsService', () => {
  const service = new PreviewLimitsService();

  it('rejects trial preview creation', () => {
    const result = service.evaluatePreviewCreation({
      planTier: 'trial',
      activePreviewCount: 0,
      forkPullRequest: false,
      usesProductionSecrets: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('PREVIEWS_DISABLED_FOR_TRIAL');
  });

  it('allows only one active preview for lower shared paid plans', () => {
    expect(
      service.evaluatePreviewCreation({
        planTier: 'lower_shared',
        activePreviewCount: 0,
        forkPullRequest: false,
        usesProductionSecrets: false,
      }).allowed,
    ).toBe(true);

    const blocked = service.evaluatePreviewCreation({
      planTier: 'lower_shared',
      activePreviewCount: 1,
      forkPullRequest: false,
      usesProductionSecrets: false,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.maxActivePreviews).toBe(1);
    expect(blocked.reasons).toContain('PREVIEW_LIMIT_REACHED');
  });

  it('allows five active previews for production business plans', () => {
    const result = service.evaluatePreviewCreation({
      planTier: 'production_business',
      activePreviewCount: 4,
      forkPullRequest: false,
      usesProductionSecrets: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.maxActivePreviews).toBe(5);
  });

  it('allows ten active previews for internal AlphaExplora products', () => {
    const result = service.evaluatePreviewCreation({
      planTier: 'internal',
      activePreviewCount: 9,
      forkPullRequest: false,
      usesProductionSecrets: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.maxActivePreviews).toBe(10);
  });

  it('rejects fork pull request previews by default', () => {
    const result = service.evaluatePreviewCreation({
      planTier: 'production_business',
      activePreviewCount: 0,
      forkPullRequest: true,
      usesProductionSecrets: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('FORK_PREVIEWS_REQUIRE_APPROVAL');
  });

  it('rejects production secret use without explicit approval', () => {
    const result = service.evaluatePreviewCreation({
      planTier: 'production_business',
      activePreviewCount: 0,
      forkPullRequest: false,
      usesProductionSecrets: true,
      productionSecretApproval: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('PRODUCTION_SECRETS_REQUIRE_APPROVAL');
  });

  it('throws a product error when asserting a rejected preview', () => {
    expect(() =>
      service.assertPreviewCreationAllowed({
        planTier: 'trial',
        activePreviewCount: 0,
        forkPullRequest: false,
        usesProductionSecrets: false,
      }),
    ).toThrow(BadRequestException);
  });
});
