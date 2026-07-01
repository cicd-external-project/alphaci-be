import { BadRequestException, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type {
  CreateGcpDeploymentTargetInput,
  FindGcpDeploymentTargetInput,
  GcpDeploymentStatus,
  GcpDeploymentTargetSummary,
  GcpProvisioningStatus,
  GcpRuntimeEnvironment,
  GcpRuntimeOwnerType,
  GcpRuntimeScope,
  GcpRuntimeServiceSlot,
  RecordGcpReconciliationEvidenceInput,
} from './gcp-runtime.types';

interface GcpDeploymentTargetRow {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_type: GcpRuntimeOwnerType;
  runtime_scope: GcpRuntimeScope;
  product_slug: string | null;
  customer_slug: string;
  app_slug: string;
  environment: GcpRuntimeEnvironment;
  service_slot: GcpRuntimeServiceSlot;
  provider: 'gcp';
  deployment_strategy: 'gcp_cloud_run';
  gcp_project_id: string;
  gcp_project_number: string | null;
  region: string;
  artifact_registry_location: string;
  artifact_registry_repo: string;
  image_name: string;
  cloud_run_service_name: string;
  runtime_service_account: string;
  deployer_service_account: string;
  provisioning_status: GcpProvisioningStatus;
  deployment_status: GcpDeploymentStatus;
  last_healthy_revision: string | null;
  last_deployment_error_code: string | null;
  last_deployment_error_safe_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class GcpDeploymentTargetsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async createDeploymentTarget(
    input: CreateGcpDeploymentTargetInput,
  ): Promise<GcpDeploymentTargetSummary> {
    this.assertRequiredFields(input);

    const result = await this.databaseService.query<GcpDeploymentTargetRow>(
      `
        INSERT INTO runtime_deployments.deployment_targets (
          workspace_id,
          project_id,
          owner_type,
          runtime_scope,
          product_slug,
          customer_slug,
          app_slug,
          environment,
          service_slot,
          gcp_project_id,
          gcp_project_number,
          region,
          artifact_registry_location,
          artifact_registry_repo,
          image_name,
          cloud_run_service_name,
          runtime_service_account,
          deployer_service_account,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *;
      `,
      [
        input.workspaceId,
        input.projectId,
        input.ownerType,
        input.runtimeScope,
        input.productSlug ?? null,
        input.customerSlug,
        input.appSlug,
        input.environment,
        input.serviceSlot,
        input.gcpProjectId,
        input.gcpProjectNumber ?? null,
        input.region,
        input.artifactRegistryLocation,
        input.artifactRegistryRepo,
        input.imageName,
        input.cloudRunServiceName,
        input.runtimeServiceAccount,
        input.deployerServiceAccount,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        'runtime_deployments.deployment_targets INSERT returned no row',
      );
    }

    return this.toSummary(row);
  }

  async findDeploymentTarget(
    input: FindGcpDeploymentTargetInput,
  ): Promise<GcpDeploymentTargetSummary | null> {
    const result = await this.databaseService.query<GcpDeploymentTargetRow>(
      `
        SELECT *
        FROM runtime_deployments.deployment_targets
        WHERE workspace_id = $1
          AND project_id = $2
          AND environment = $3
          AND service_slot = $4
        LIMIT 1;
      `,
      [
        input.workspaceId,
        input.projectId,
        input.environment,
        input.serviceSlot,
      ],
    );

    const row = result.rows[0];
    return row ? this.toSummary(row) : null;
  }

  async recordReconciliationEvidence(
    input: RecordGcpReconciliationEvidenceInput,
  ): Promise<GcpDeploymentTargetSummary> {
    if (!input.targetId.trim()) {
      throw new BadRequestException('targetId is required');
    }

    const reconciliation = {
      status: input.status,
      lastCheckedAt: input.lastCheckedAt,
      ...(input.lastObservedUrl
        ? { lastObservedUrl: input.lastObservedUrl }
        : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };

    const result = await this.databaseService.query<GcpDeploymentTargetRow>(
      `
        UPDATE runtime_deployments.deployment_targets
        SET
          last_healthy_revision = $2,
          last_deployment_error_code = $3,
          last_deployment_error_safe_message = $4,
          deployment_status = $5,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reconciliation', $6::jsonb),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *;
      `,
      [
        input.targetId,
        input.lastObservedRevision ?? null,
        input.lastErrorCode ?? null,
        input.lastErrorMessage ?? null,
        input.deploymentStatus,
        JSON.stringify(reconciliation),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        'runtime_deployments.deployment_targets reconciliation update returned no row',
      );
    }

    return this.toSummary(row);
  }
  private assertRequiredFields(input: CreateGcpDeploymentTargetInput): void {
    const required: Array<[keyof CreateGcpDeploymentTargetInput, string]> = [
      ['workspaceId', 'workspaceId'],
      ['projectId', 'projectId'],
      ['customerSlug', 'customerSlug'],
      ['appSlug', 'appSlug'],
      ['gcpProjectId', 'gcpProjectId'],
      ['region', 'region'],
      ['artifactRegistryLocation', 'artifactRegistryLocation'],
      ['artifactRegistryRepo', 'artifactRegistryRepo'],
      ['imageName', 'imageName'],
      ['cloudRunServiceName', 'cloudRunServiceName'],
      ['runtimeServiceAccount', 'runtimeServiceAccount'],
      ['deployerServiceAccount', 'deployerServiceAccount'],
    ];

    for (const [key, label] of required) {
      const value = input[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new BadRequestException(`${label} is required`);
      }
    }
  }

  private toSummary(row: GcpDeploymentTargetRow): GcpDeploymentTargetSummary {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      ownerType: row.owner_type,
      runtimeScope: row.runtime_scope,
      productSlug: row.product_slug,
      customerSlug: row.customer_slug,
      appSlug: row.app_slug,
      environment: row.environment,
      serviceSlot: row.service_slot,
      provider: row.provider,
      deploymentStrategy: row.deployment_strategy,
      gcpProjectId: row.gcp_project_id,
      gcpProjectNumber: row.gcp_project_number,
      region: row.region,
      artifactRegistryLocation: row.artifact_registry_location,
      artifactRegistryRepo: row.artifact_registry_repo,
      imageName: row.image_name,
      cloudRunServiceName: row.cloud_run_service_name,
      runtimeServiceAccount: row.runtime_service_account,
      deployerServiceAccount: row.deployer_service_account,
      provisioningStatus: row.provisioning_status,
      deploymentStatus: row.deployment_status,
      lastHealthyRevision: row.last_healthy_revision,
      lastDeploymentErrorCode: row.last_deployment_error_code,
      lastDeploymentErrorSafeMessage: row.last_deployment_error_safe_message,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
