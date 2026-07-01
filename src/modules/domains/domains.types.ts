export type RuntimeDomainKind = 'generated' | 'preview' | 'custom' | 'fallback';
export type RuntimeDomainRoutingMode = 'load_balancer' | 'cloud_run_domain_mapping' | 'dns_only' | 'manual';
export type RuntimeDomainCertificateStatus =
  | 'pending'
  | 'provisioning'
  | 'active'
  | 'failed'
  | 'not_required';
export type DomainVerifierMode = 'missing' | 'matched' | 'mismatched';

export interface DnsInstructions {
  type: 'CNAME';
  name: string;
  value: string;
  status?: DomainVerifierMode;
  message?: string;
}

export interface RuntimeDomainSummary {
  id: string;
  deploymentTargetId: string;
  hostname: string;
  domainBase: string;
  kind: RuntimeDomainKind;
  routingMode: RuntimeDomainRoutingMode;
  isPrimary: boolean;
  certificateStatus: RuntimeDomainCertificateStatus;
  dnsInstructions: DnsInstructions;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainRecordInput {
  deploymentTargetId: string;
  hostname: string;
  domainBase: string;
  kind: RuntimeDomainKind;
  routingMode: RuntimeDomainRoutingMode;
  isPrimary: boolean;
  certificateStatus: RuntimeDomainCertificateStatus;
  dnsInstructions: DnsInstructions;
}

export interface UpdateDomainVerificationInput {
  domainId: string;
  certificateStatus: RuntimeDomainCertificateStatus;
  dnsInstructions: DnsInstructions;
  lastVerifiedAt: string;
}

export interface DomainVerificationInput {
  hostname: string;
  expectedTarget: string;
}

export interface DomainVerificationResult {
  mode: DomainVerifierMode;
  matched: boolean;
  dnsInstructions: DnsInstructions;
}

export interface DomainVerifier {
  verify(input: DomainVerificationInput): Promise<DomainVerificationResult>;
}
