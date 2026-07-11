import { BadRequestException, Injectable } from '@nestjs/common';

import type {
  PlanPreviewCleanupInput,
  PreviewCleanupCandidate,
  PreviewCleanupPlan,
} from './gcp-previews.types';

@Injectable()
export class PreviewCleanupService {
  planCleanup(input: PlanPreviewCleanupInput): PreviewCleanupPlan {
    this.assertPreviewResource(input);

    return {
      previewId: input.previewId,
      cleanupStatus: 'cleanup_required',
      reason: input.reason,
      liveMutationAllowed: false,
      resourcesToDelete: {
        cloudRunServices: [input.cloudRunServiceName],
        domainRecords: [input.previewDomain],
        imageTags: [...input.imageTags],
        secretVersions: [...input.secretVersionNames],
      },
    };
  }

  selectCleanupCandidates(
    previews: PreviewCleanupCandidate[],
    now: Date = new Date(),
  ): PreviewCleanupCandidate[] {
    return previews.filter((preview) => {
      if (
        preview.lifecycleStatus === 'cleanup_required' ||
        preview.cleanupStatus === 'pending'
      ) {
        return true;
      }

      return new Date(preview.expiresAt).getTime() <= now.getTime();
    });
  }

  private assertPreviewResource(input: PlanPreviewCleanupInput): void {
    if (input.labels['environment'] !== 'preview') {
      throw new BadRequestException({
        code: 'PREVIEW_CLEANUP_LABEL_MISMATCH',
        message:
          'Preview cleanup requires preview labels before any delete can be planned.',
      });
    }

    if (
      !input.labels['pullRequestNumber'] ||
      !/-pr-\d+-/.test(input.cloudRunServiceName)
    ) {
      throw new BadRequestException({
        code: 'PREVIEW_CLEANUP_TARGET_UNSAFE',
        message:
          'Preview cleanup target does not match the expected pull request service shape.',
      });
    }
  }
}
