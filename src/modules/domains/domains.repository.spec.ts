import { DomainsRepository } from './domains.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'domain-1',
    deployment_target_id: 'target-1',
    domain: 'alpha-demo-dev.itsandbox.site',
    domain_base: 'itsandbox.site',
    domain_kind: 'generated',
    routing_mode: 'load_balancer',
    is_primary: true,
    certificate_status: 'pending',
    dns_instructions: {},
    last_verified_at: null,
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('DomainsRepository', () => {
  const databaseService = {
    query: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates domain records without secret payload columns', async () => {
    databaseService.query.mockResolvedValueOnce({ rows: [makeRow()] });
    const repository = new DomainsRepository(databaseService as never);

    await repository.createDomainRecord({
      deploymentTargetId: 'target-1',
      hostname: 'alpha-demo-dev.itsandbox.site',
      domainBase: 'itsandbox.site',
      kind: 'generated',
      routingMode: 'load_balancer',
      isPrimary: true,
      certificateStatus: 'pending',
      dnsInstructions: {
        type: 'CNAME',
        name: 'alpha-demo-dev',
        value: 'edge.itsandbox.site',
      },
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO runtime_domains.domain_records'),
      expect.arrayContaining(['target-1', 'alpha-demo-dev.itsandbox.site']),
    );
    expect(JSON.stringify(databaseService.query.mock.calls[0])).not.toContain(
      'secret',
    );
  });

  it('updates verification status without querying live DNS', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [makeRow({ certificate_status: 'active' })],
    });
    const repository = new DomainsRepository(databaseService as never);

    await repository.updateVerificationResult({
      domainId: 'domain-1',
      certificateStatus: 'active',
      dnsInstructions: {
        type: 'CNAME',
        name: 'api.customer.test',
        value: 'edge.itsandbox.site',
        status: 'matched',
      },
      lastVerifiedAt: '2026-07-02T00:00:00.000Z',
    });

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('certificate_status = $2'),
      expect.arrayContaining(['domain-1', 'active']),
    );
  });
});
