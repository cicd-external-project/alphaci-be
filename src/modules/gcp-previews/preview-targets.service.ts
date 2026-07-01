import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { GcpProvisioningOrchestratorService } from '../gcp-control/gcp-provisioning-orchestrator.service';
import { PreviewLimitsService } from './preview-limits.service';
import type {
  PlanPullRequestPreviewInput,
  PlannedPreviewTarget,
} from './gcp-previews.types';

const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PreviewTargetsService {
  constructor(
    private readonly previewLimitsService: PreviewLimitsService,
    private readonly provisioningOrchestrator: GcpProvisioningOrchestratorService,
  ) {}

  async planPullRequestPreview(
    input: PlanPullRequestPreviewInput,
  ): Promise<PlannedPreviewTarget> {
    this.previewLimitsService.assertPreviewCreationAllowed(input);

    const customerSlug = toSlug(input.customerSlug);
    const appSlug = toSlug(input.appSlug);
    const sourceBranchHash = hashBranch(input.sourceBranch);
    const cloudRunServiceName = `ac-${customerSlug}-${appSlug}-pr-${input.pullRequestNumber}-${input.serviceSlot}`;
    const previewDomain = `pr-${input.pullRequestNumber}-${appSlug}-${customerSlug}.${input.managedDomainBase}`;
    const correlationId = `preview-${input.projectId}-pr-${input.pullRequestNumber}-${input.serviceSlot}`;
    const idempotencyKey = `preview:${input.workspaceId}:${input.projectId}:${input.pullRequestNumber}:${input.serviceSlot}`;
    const labels = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      deploymentTargetId: input.deploymentTargetId,
      environment: 'preview',
      pullRequestNumber: String(input.pullRequestNumber),
      serviceSlot: input.serviceSlot,
      sourceBranchHash,
    };

    const provisioning = await this.provisioningOrchestrator.provisionTarget({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      deploymentTargetId: input.deploymentTargetId,
      projectSlug: appSlug,
      environment: 'preview',
      serviceName: cloudRunServiceName,
      imageName: `preview-${appSlug}-pr-${input.pullRequestNumber}`,
      runtimePlacement: 'shared',
      sharedProjectId: input.sharedProjectId,
      artifactRegistryRepository: input.artifactRegistryRepository,
      region: input.region,
      correlationId,
      idempotencyKey,
    });

    return {
      previewId: idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      deploymentTargetId: input.deploymentTargetId,
      repositoryFullName: input.repositoryFullName,
      pullRequestNumber: input.pullRequestNumber,
      sourceBranchHash,
      commitSha: input.commitSha,
      cloudRunServiceName,
      previewDomain,
      previewUrl: `https://${previewDomain}`,
      lifecycleStatus: 'requested',
      cleanupStatus: 'none',
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      labels,
      provisioningJobId: provisioning.jobId,
      provisioningStatus: provisioning.status,
    };
  }
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function hashBranch(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
