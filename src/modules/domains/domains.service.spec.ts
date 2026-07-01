import { BadRequestException } from '@nestjs/common';

import { DomainsService } from './domains.service';
import { FakeDomainVerifier } from './fake-domain-verifier';

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'domain-1',
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
    lastVerifiedAt: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('DomainsService', () => {
  const repository = {
    createDomainRecord: jest.fn(),
    findActiveDomainByHostname: jest.fn(),
    updateVerificationResult: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findActiveDomainByHostname.mockResolvedValue(null);
    repository.createDomainRecord.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(makeRecord({ hostname: input.hostname, kind: input.kind })),
    );
    repository.updateVerificationResult.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        makeRecord({
          id: input.domainId,
          certificateStatus: input.certificateStatus,
          dnsInstructions: input.dnsInstructions,
          lastVerifiedAt: input.lastVerifiedAt,
        }),
      ),
    );
  });

  it('reserves a dev managed subdomain under the configured base domain', async () => {
    const service = new DomainsService(repository as never, new FakeDomainVerifier());

    await service.reserveManagedDomain({
      deploymentTargetId: 'target-1',
      projectSlug: 'Alpha Demo',
      environment: 'dev',
      managedDomainBase: 'itsandbox.site',
    });

    expect(repository.createDomainRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentTargetId: 'target-1',
        hostname: 'alpha-demo-dev.itsandbox.site',
        domainBase: 'itsandbox.site',
        kind: 'generated',
        routingMode: 'load_balancer',
        isPrimary: true,
      }),
    );
  });

  it('reserves a prod managed subdomain without the prod suffix', async () => {
    const service = new DomainsService(repository as never, new FakeDomainVerifier());

    await service.reserveManagedDomain({
      deploymentTargetId: 'target-1',
      projectSlug: 'Alpha Demo',
      environment: 'prod',
      managedDomainBase: 'itsandbox.site',
    });

    expect(repository.createDomainRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'alpha-demo.itsandbox.site',
      }),
    );
  });

  it('reserves custom domains as pending verification records', async () => {
    const service = new DomainsService(repository as never, new FakeDomainVerifier());

    await service.reserveCustomDomain({
      deploymentTargetId: 'target-1',
      hostname: 'api.customer.test',
      expectedTarget: 'edge.itsandbox.site',
    });

    expect(repository.createDomainRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'api.customer.test',
        domainBase: 'customer.test',
        kind: 'custom',
        certificateStatus: 'pending',
        dnsInstructions: expect.objectContaining({
          type: 'CNAME',
          value: 'edge.itsandbox.site',
        }),
      }),
    );
  });

  it('does not attach one custom domain to two active projects', async () => {
    repository.findActiveDomainByHostname.mockResolvedValueOnce(
      makeRecord({ deploymentTargetId: 'target-other', hostname: 'api.customer.test' }),
    );
    const service = new DomainsService(repository as never, new FakeDomainVerifier());

    await expect(
      service.reserveCustomDomain({
        deploymentTargetId: 'target-1',
        hostname: 'api.customer.test',
        expectedTarget: 'edge.itsandbox.site',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.createDomainRecord).not.toHaveBeenCalled();
  });

  it('keeps custom domains pending when the fake verifier reports missing DNS', async () => {
    const service = new DomainsService(
      repository as never,
      new FakeDomainVerifier({ mode: 'missing' }),
    );

    const result = await service.verifyDomain({
      domainId: 'domain-1',
      hostname: 'api.customer.test',
      expectedTarget: 'edge.itsandbox.site',
    });

    expect(repository.updateVerificationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        domainId: 'domain-1',
        certificateStatus: 'pending',
      }),
    );
    expect(result.certificateStatus).toBe('pending');
  });

  it('activates custom domains when the fake verifier reports matching DNS', async () => {
    const service = new DomainsService(
      repository as never,
      new FakeDomainVerifier({ mode: 'matched' }),
    );

    const result = await service.verifyDomain({
      domainId: 'domain-1',
      hostname: 'api.customer.test',
      expectedTarget: 'edge.itsandbox.site',
    });

    expect(repository.updateVerificationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        domainId: 'domain-1',
        certificateStatus: 'active',
      }),
    );
    expect(result.certificateStatus).toBe('active');
  });
});
