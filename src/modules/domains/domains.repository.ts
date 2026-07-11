import { BadRequestException, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import type {
  CreateDomainRecordInput,
  RuntimeDomainCertificateStatus,
  RuntimeDomainKind,
  RuntimeDomainRoutingMode,
  RuntimeDomainSummary,
  DnsInstructions,
  DomainVerifierMode,
  UpdateDomainVerificationInput,
} from './domains.types';

interface RuntimeDomainRow {
  id: string;
  deployment_target_id: string;
  domain: string;
  domain_base: string;
  domain_kind: RuntimeDomainKind;
  routing_mode: RuntimeDomainRoutingMode;
  is_primary: boolean;
  certificate_status: RuntimeDomainCertificateStatus;
  dns_instructions: Record<string, unknown> | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class DomainsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async createDomainRecord(
    input: CreateDomainRecordInput,
  ): Promise<RuntimeDomainSummary> {
    this.assertHostname(input.hostname);
    const result = await this.databaseService.query<RuntimeDomainRow>(
      `
        INSERT INTO runtime_domains.domain_records (
          deployment_target_id,
          domain,
          domain_base,
          domain_kind,
          routing_mode,
          is_primary,
          certificate_status,
          dns_instructions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `,
      [
        input.deploymentTargetId,
        input.hostname,
        input.domainBase,
        input.kind,
        input.routingMode,
        input.isPrimary,
        input.certificateStatus,
        JSON.stringify(input.dnsInstructions),
      ],
    );

    return this.singleRow(result.rows[0], 'domain record create');
  }

  async findActiveDomainByHostname(
    hostname: string,
  ): Promise<RuntimeDomainSummary | null> {
    this.assertHostname(hostname);
    const result = await this.databaseService.query<RuntimeDomainRow>(
      `
        SELECT *
        FROM runtime_domains.domain_records
        WHERE domain = $1
          AND is_deprecated = false
        LIMIT 1;
      `,
      [hostname.toLowerCase()],
    );

    const row = result.rows[0];
    return row ? this.toSummary(row) : null;
  }

  async updateVerificationResult(
    input: UpdateDomainVerificationInput,
  ): Promise<RuntimeDomainSummary> {
    const result = await this.databaseService.query<RuntimeDomainRow>(
      `
        UPDATE runtime_domains.domain_records
        SET
          certificate_status = $2,
          dns_instructions = $3,
          last_verified_at = $4,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *;
      `,
      [
        input.domainId,
        input.certificateStatus,
        JSON.stringify(input.dnsInstructions),
        input.lastVerifiedAt,
      ],
    );

    return this.singleRow(result.rows[0], 'domain verification update');
  }

  private assertHostname(hostname: string): void {
    if (!hostname.trim()) {
      throw new BadRequestException('hostname is required');
    }
  }

  private singleRow(
    row: RuntimeDomainRow | undefined,
    operation: string,
  ): RuntimeDomainSummary {
    if (!row) {
      throw new Error(`${operation} returned no row`);
    }

    return this.toSummary(row);
  }

  private toDnsInstructions(
    value: Record<string, unknown> | null,
  ): DnsInstructions {
    const instructions: DnsInstructions = {
      type: 'CNAME',
      name: typeof value?.['name'] === 'string' ? value['name'] : '',
      value: typeof value?.['value'] === 'string' ? value['value'] : '',
    };

    if (this.isVerifierMode(value?.['status'])) {
      instructions.status = value['status'];
    }
    if (typeof value?.['message'] === 'string') {
      instructions.message = value['message'];
    }

    return instructions;
  }

  private isVerifierMode(value: unknown): value is DomainVerifierMode {
    return value === 'missing' || value === 'matched' || value === 'mismatched';
  }
  private toSummary(row: RuntimeDomainRow): RuntimeDomainSummary {
    return {
      id: row.id,
      deploymentTargetId: row.deployment_target_id,
      hostname: row.domain,
      domainBase: row.domain_base,
      kind: row.domain_kind,
      routingMode: row.routing_mode,
      isPrimary: row.is_primary,
      certificateStatus: row.certificate_status,
      dnsInstructions: this.toDnsInstructions(row.dns_instructions),
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
