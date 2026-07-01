import { BadRequestException, Injectable } from '@nestjs/common';

import type {
  EvaluatePreviewCreationInput,
  PreviewCreationDecision,
  PreviewPlanTier,
} from './gcp-previews.types';

const PREVIEW_LIMITS: Record<PreviewPlanTier, number> = {
  trial: 0,
  lower_shared: 1,
  production_business: 5,
  internal: 10,
};

@Injectable()
export class PreviewLimitsService {
  evaluatePreviewCreation(
    input: EvaluatePreviewCreationInput,
  ): PreviewCreationDecision {
    const maxActivePreviews = PREVIEW_LIMITS[input.planTier];
    const reasons: string[] = [];

    if (maxActivePreviews === 0) {
      reasons.push('PREVIEWS_DISABLED_FOR_TRIAL');
    }

    if (
      input.activePreviewCount >= maxActivePreviews &&
      maxActivePreviews > 0
    ) {
      reasons.push('PREVIEW_LIMIT_REACHED');
    }

    if (input.forkPullRequest) {
      reasons.push('FORK_PREVIEWS_REQUIRE_APPROVAL');
    }

    if (
      input.usesProductionSecrets &&
      input.productionSecretApproval !== true
    ) {
      reasons.push('PRODUCTION_SECRETS_REQUIRE_APPROVAL');
    }

    return {
      allowed: reasons.length === 0,
      maxActivePreviews,
      reasons,
    };
  }

  assertPreviewCreationAllowed(
    input: EvaluatePreviewCreationInput,
  ): PreviewCreationDecision {
    const decision = this.evaluatePreviewCreation(input);
    if (!decision.allowed) {
      throw new BadRequestException({
        code: 'PREVIEW_DEPLOYMENT_NOT_ALLOWED',
        message: 'Preview deployment is not allowed for this project state.',
        reasons: decision.reasons,
      });
    }

    return decision;
  }
}
