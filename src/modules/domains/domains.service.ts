import { BadRequestException, Injectable } from '@nestjs/common';

import { DomainsRepository } from './domains.repository';
import { FakeDomainVerifier } from './fake-domain-verifier';
import type {
  DomainVerifier,
  RuntimeDomainSummary,
} from './domains.types';

export interface ReserveManagedDomainInput {
  deploymentTargetId: string;
  projectSlug: string;
  environment: 'dev' | 'stg' | 'uat' | 'prod' | 'preview';
  managedDomainBase?: string;
}

export interface ReserveCustomDomainInput {
  deploymentTargetId: string;
  hostname: string;
  expectedTarget: string;
}

export interface VerifyDomainInput {
  domainId: string;
  hostname: string;
  expectedTarget: string;
}

@Injectable()
export class DomainsService {
  constructor(
    private readonly repository: DomainsRepository,
    private readonly verifier: DomainVerifier = new FakeDomainVerifier(),
  ) {}

  async reserveManagedDomain(
    input: ReserveManagedDomainInput,
  ): Promise<RuntimeDomainSummary> {
    const domainBase = this.normalizeHostname(
      input.managedDomainBase ?? 'itsandbox.site',
    );
    const projectSlug = this.slugify(input.projectSlug);
    const environmentSuffix = input.environment === 'prod' ? '' : `-${input.environment}`;
    const hostname = `${projectSlug}${environmentSuffix}.${domainBase}`;

    return this.repository.createDomainRecord({
      deploymentTargetId: input.deploymentTargetId,
      hostname,
      domainBase,
      kind: input.environment === 'preview' ? 'preview' : 'generated',
      routingMode: 'load_balancer',
      isPrimary: input.environment === 'prod' || input.environment === 'dev',
      certificateStatus: 'pending',
      dnsInstructions: {
        type: 'CNAME',
        name: hostname.replace(`.${domainBase}`, ''),
        value: `edge.${domainBase}`,
      },
    });
  }

  async reserveCustomDomain(
    input: ReserveCustomDomainInput,
  ): Promise<RuntimeDomainSummary> {
    const hostname = this.normalizeHostname(input.hostname);
    const existing = await this.repository.findActiveDomainByHostname(hostname);
    if (existing && existing.deploymentTargetId !== input.deploymentTargetId) {
      throw new BadRequestException('Domain is already attached to another project');
    }

    return this.repository.createDomainRecord({
      deploymentTargetId: input.deploymentTargetId,
      hostname,
      domainBase: this.domainBaseFromHostname(hostname),
      kind: 'custom',
      routingMode: 'load_balancer',
      isPrimary: false,
      certificateStatus: 'pending',
      dnsInstructions: {
        type: 'CNAME',
        name: hostname,
        value: input.expectedTarget,
      },
    });
  }

  async verifyDomain(input: VerifyDomainInput): Promise<RuntimeDomainSummary> {
    const verification = await this.verifier.verify({
      hostname: this.normalizeHostname(input.hostname),
      expectedTarget: input.expectedTarget,
    });

    return this.repository.updateVerificationResult({
      domainId: input.domainId,
      certificateStatus: verification.matched ? 'active' : 'pending',
      dnsInstructions: verification.dnsInstructions,
      lastVerifiedAt: new Date().toISOString(),
    });
  }

  private normalizeHostname(hostname: string): string {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized || normalized.includes('://') || normalized.includes('/')) {
      throw new BadRequestException('Domain hostname must be a bare hostname');
    }

    return normalized;
  }

  private domainBaseFromHostname(hostname: string): string {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length < 2) {
      throw new BadRequestException('Custom domain must contain a registrable base');
    }

    return parts.slice(-2).join('.');
  }

  private slugify(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) {
      throw new BadRequestException('projectSlug is required');
    }

    return slug;
  }
}
