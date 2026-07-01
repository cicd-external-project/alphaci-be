import { Inject, Injectable } from '@nestjs/common';

import type { ProvisioningJobsRepository } from './provisioning-jobs.repository';
import type {
  ProvisioningJobSummary,
  SafeProvisioningError,
} from './gcp-control.types';
import {
  GCP_RUNTIME_ADAPTER,
  GcpRuntimeAdapterError,
  type GcpRuntimeAdapter,
  type GcpRuntimeEnvironment,
  type GcpRuntimeLabels,
  type GcpRuntimePlacement,
} from './gcp-runtime.adapter';

export interface ProvisionGcpRuntimeTargetInput {
  workspaceId: string;
  projectId: string;
  deploymentTargetId?: string | null;
  projectSlug: string;
  environment: GcpRuntimeEnvironment;
  serviceName: string;
  imageName?: string;
  runtimePlacement: GcpRuntimePlacement;
  sharedProjectId: string;
  dedicatedProjectId?: string;
  dedicatedProjectApproved?: boolean;
  artifactRegistryRepository: string;
  region: string;
  correlationId?: string;
  idempotencyKey?: string;
}

export interface ProvisionGcpRuntimeTargetResult {
  jobId: string;
  status:
    | 'succeeded'
    | 'pending_approval'
    | 'failed'
    | ProvisioningJobSummary['status'];
  runtimePlacement: GcpRuntimePlacement;
  gcpProjectId?: string;
  serviceUrl?: string;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
  correlationId?: string;
}

@Injectable()
export class GcpProvisioningOrchestratorService {
  constructor(
    private readonly provisioningJobsRepository: ProvisioningJobsRepository,
    @Inject(GCP_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: GcpRuntimeAdapter,
  ) {}

  async provisionTarget(
    input: ProvisionGcpRuntimeTargetInput,
  ): Promise<ProvisionGcpRuntimeTargetResult> {
    const idempotencyKey =
      input.idempotencyKey ??
      `${input.workspaceId}:${input.projectId}:${input.deploymentTargetId ?? 'target'}:${input.environment}`;
    const existingJob =
      await this.provisioningJobsRepository.findByIdempotencyKey(
        idempotencyKey,
      );
    if (existingJob) {
      return this.resultFromExistingJob(existingJob, input.runtimePlacement);
    }

    const gcpProjectId = this.resolveGcpProjectId(input);
    const payload = this.buildJobPayload(input, gcpProjectId);
    const job = await this.provisioningJobsRepository.createJob({
      jobType: 'provision_target',
      idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      deploymentTargetId: input.deploymentTargetId ?? null,
      payload,
    });

    if (
      input.runtimePlacement === 'dedicated' &&
      !input.dedicatedProjectApproved
    ) {
      return {
        jobId: job.id,
        status: 'pending_approval',
        runtimePlacement: 'dedicated',
        gcpProjectId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      };
    }

    try {
      const resultPayload = await this.ensureRuntime(input, gcpProjectId);
      const succeededJob = await this.provisioningJobsRepository.markSucceeded(
        job.id,
        resultPayload,
      );

      return {
        jobId: succeededJob.id,
        status: 'succeeded',
        runtimePlacement: input.runtimePlacement,
        ...(resultPayload.gcpProjectId
          ? { gcpProjectId: resultPayload.gcpProjectId }
          : {}),
        ...(resultPayload.serviceUrl
          ? { serviceUrl: resultPayload.serviceUrl }
          : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      };
    } catch (error) {
      const safeError = this.toSafeProvisioningError(error);
      const failedJob =
        await this.provisioningJobsRepository.markRetryableFailure(
          job.id,
          safeError,
        );

      return {
        jobId: failedJob.id,
        status: 'failed',
        runtimePlacement: input.runtimePlacement,
        gcpProjectId,
        safeErrorCode: failedJob.safeErrorCode,
        safeErrorMessage: failedJob.safeErrorMessage,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      };
    }
  }

  private async ensureRuntime(
    input: ProvisionGcpRuntimeTargetInput,
    gcpProjectId: string,
  ): Promise<Record<string, string>> {
    const labels = this.buildLabels(input);
    await this.runtimeAdapter.ensureProject({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      gcpProjectId,
      runtimePlacement: input.runtimePlacement,
      region: input.region,
      labels,
    });
    const registry = await this.runtimeAdapter.ensureArtifactRegistry({
      gcpProjectId,
      region: input.region,
      repository: input.artifactRegistryRepository,
      labels,
    });
    const serviceAccount =
      await this.runtimeAdapter.ensureRuntimeServiceAccount({
        gcpProjectId,
        serviceName: input.serviceName,
        labels,
      });
    const cloudRun = await this.runtimeAdapter.ensureCloudRunService({
      gcpProjectId,
      region: input.region,
      serviceName: input.serviceName,
      imageName: input.imageName ?? input.serviceName,
      runtimeServiceAccountEmail: serviceAccount.email,
      labels,
    });

    return {
      gcpProjectId,
      region: input.region,
      artifactRegistryRepository: registry.repositoryUri,
      runtimeServiceAccountEmail: serviceAccount.email,
      cloudRunServiceName: cloudRun.serviceName,
      cloudRunResourceName: cloudRun.resourceName,
      serviceUrl: cloudRun.serviceUrl,
      revision: cloudRun.revision,
      runtimePlacement: input.runtimePlacement,
      correlationId: input.correlationId ?? '',
    };
  }

  private buildLabels(input: ProvisionGcpRuntimeTargetInput): GcpRuntimeLabels {
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ...(input.deploymentTargetId
        ? { deploymentTargetId: input.deploymentTargetId }
        : {}),
      environment: input.environment,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
  }

  private buildJobPayload(
    input: ProvisionGcpRuntimeTargetInput,
    gcpProjectId: string,
  ): Record<string, unknown> {
    return {
      runtimePlacement: input.runtimePlacement,
      gcpProjectId,
      region: input.region,
      serviceName: input.serviceName,
      projectSlug: input.projectSlug,
      artifactRegistryRepository: input.artifactRegistryRepository,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.runtimePlacement === 'dedicated'
        ? {
            dedicatedProjectIntent: {
              gcpProjectId,
              approvalRequired: !input.dedicatedProjectApproved,
            },
          }
        : {}),
    };
  }

  private resolveGcpProjectId(input: ProvisionGcpRuntimeTargetInput): string {
    if (input.runtimePlacement === 'dedicated') {
      return input.dedicatedProjectId ?? input.sharedProjectId;
    }

    return input.sharedProjectId;
  }

  private resultFromExistingJob(
    job: ProvisioningJobSummary,
    runtimePlacement: GcpRuntimePlacement,
  ): ProvisionGcpRuntimeTargetResult {
    const result = this.asResultPayload(job.payload['result']);
    return {
      jobId: job.id,
      status: job.status,
      runtimePlacement,
      ...(result.gcpProjectId ? { gcpProjectId: result.gcpProjectId } : {}),
      ...(result.serviceUrl ? { serviceUrl: result.serviceUrl } : {}),
      safeErrorCode: job.safeErrorCode,
      safeErrorMessage: job.safeErrorMessage,
      ...(result.correlationId ? { correlationId: result.correlationId } : {}),
    };
  }

  private asResultPayload(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce(
      (payload, [key, entry]) => {
        if (typeof entry === 'string') {
          payload[key] = entry;
        }
        return payload;
      },
      {} as Record<string, string>,
    );
  }

  private toSafeProvisioningError(error: unknown): SafeProvisioningError {
    const nextRetryAt = new Date(Date.now() + 60_000).toISOString();
    if (error instanceof GcpRuntimeAdapterError) {
      return {
        code: error.code,
        safeMessage: error.safeMessage,
        nextRetryAt,
      };
    }

    return {
      code: 'GCP_RUNTIME_OPERATION_FAILED',
      safeMessage: 'GCP runtime operation failed',
      nextRetryAt,
    };
  }
}
