import { Inject, Injectable } from '@nestjs/common';

import { GcpDeploymentTargetsRepository } from '../gcp-runtime/deployment-targets-gcp.repository';
import type {
  GcpDeploymentStatus,
  GcpDeploymentTargetSummary,
  GcpRuntimeReconciliationStatus,
} from '../gcp-runtime/gcp-runtime.types';
import { ProvisioningJobsRepository } from './provisioning-jobs.repository';
import {
  GCP_RUNTIME_ADAPTER,
  GcpRuntimeAdapterError,
  type GcpRuntimeAdapter,
} from './gcp-runtime.adapter';

export interface ReconcileGcpRuntimeTargetInput {
  target: GcpDeploymentTargetSummary;
  correlationId?: string;
}

export interface ReconcileGcpRuntimeTargetResult {
  targetId: string;
  status: GcpRuntimeReconciliationStatus;
  deploymentStatus: GcpDeploymentStatus;
  serviceUrl?: string;
  revision?: string;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
  nextRetryAt?: string | null;
  correlationId?: string;
}

@Injectable()
export class GcpRuntimeReconcilerService {
  constructor(
    private readonly deploymentTargetsRepository: GcpDeploymentTargetsRepository,
    private readonly provisioningJobsRepository: ProvisioningJobsRepository,
    @Inject(GCP_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: GcpRuntimeAdapter,
  ) {}

  async reconcileTarget(
    input: ReconcileGcpRuntimeTargetInput,
  ): Promise<ReconcileGcpRuntimeTargetResult> {
    const checkedAt = new Date().toISOString();
    try {
      const service = await this.runtimeAdapter.getCloudRunService({
        gcpProjectId: input.target.gcpProjectId,
        region: input.target.region,
        serviceName: input.target.cloudRunServiceName,
      });
      await this.deploymentTargetsRepository.recordReconciliationEvidence({
        targetId: input.target.id,
        status: 'ready',
        deploymentStatus: 'healthy',
        lastCheckedAt: checkedAt,
        lastObservedRevision: service.revision,
        lastObservedUrl: service.serviceUrl,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      });

      return {
        targetId: input.target.id,
        status: 'ready',
        deploymentStatus: 'healthy',
        serviceUrl: service.serviceUrl,
        revision: service.revision,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      };
    } catch (error) {
      return this.recordFailure(input, checkedAt, error);
    }
  }

  private async recordFailure(
    input: ReconcileGcpRuntimeTargetInput,
    checkedAt: string,
    error: unknown,
  ): Promise<ReconcileGcpRuntimeTargetResult> {
    const safeError = this.toSafeError(error);
    const retryableJob = await this.findRetryableJob(input.target);
    const status = this.resolveFailureStatus(safeError.code, retryableJob);
    const deploymentStatus = this.toDeploymentStatus(status);

    await this.deploymentTargetsRepository.recordReconciliationEvidence({
      targetId: input.target.id,
      status,
      deploymentStatus,
      lastCheckedAt: checkedAt,
      lastErrorCode: safeError.code,
      lastErrorMessage: safeError.safeMessage,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });

    return {
      targetId: input.target.id,
      status,
      deploymentStatus,
      safeErrorCode: safeError.code,
      safeErrorMessage: safeError.safeMessage,
      ...(retryableJob?.nextRetryAt
        ? { nextRetryAt: retryableJob.nextRetryAt }
        : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
  }

  private async findRetryableJob(target: GcpDeploymentTargetSummary) {
    const idempotencyKey = `${target.workspaceId}:${target.projectId}:${target.id}:${target.environment}`;
    const job =
      await this.provisioningJobsRepository.findByIdempotencyKey(
        idempotencyKey,
      );

    if (job?.status === 'failed' && job.nextRetryAt) {
      return job;
    }

    return null;
  }

  private resolveFailureStatus(
    errorCode: string,
    retryableJob: { nextRetryAt: string | null } | null,
  ): GcpRuntimeReconciliationStatus {
    if (retryableJob?.nextRetryAt) {
      return 'retry_pending';
    }

    if (errorCode === 'GCP_PERMISSION_DENIED') {
      return 'blocked_by_access';
    }

    if (errorCode === 'GCP_CLOUD_RUN_SERVICE_MISSING') {
      return 'drifted';
    }

    return 'failed';
  }

  private toDeploymentStatus(
    status: GcpRuntimeReconciliationStatus,
  ): GcpDeploymentStatus {
    if (status === 'retry_pending') {
      return 'queued';
    }

    if (status === 'blocked_by_access' || status === 'failed') {
      return 'failed';
    }

    return 'unhealthy';
  }

  private toSafeError(error: unknown): { code: string; safeMessage: string } {
    if (error instanceof GcpRuntimeAdapterError) {
      return {
        code: error.code,
        safeMessage: error.safeMessage,
      };
    }

    return {
      code: 'GCP_RUNTIME_RECONCILE_FAILED',
      safeMessage: 'GCP runtime reconciliation failed',
    };
  }
}
