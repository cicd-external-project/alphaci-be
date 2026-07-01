import { DomainsController } from './domains.controller';
import type { DomainsService } from './domains.service';

describe('DomainsController', () => {
  const service = {
    reserveManagedDomain: jest.fn(),
    reserveCustomDomain: jest.fn(),
    verifyDomain: jest.fn(),
  } as unknown as jest.Mocked<DomainsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    service.reserveManagedDomain.mockResolvedValue({
      id: 'managed-domain',
    } as never);
    service.reserveCustomDomain.mockResolvedValue({
      id: 'custom-domain',
    } as never);
    service.verifyDomain.mockResolvedValue({ id: 'verified-domain' } as never);
  });

  it('reserves managed domains through the service', async () => {
    const controller = new DomainsController(service);
    const body = {
      deploymentTargetId: 'target-1',
      projectSlug: 'alpha-demo',
      environment: 'dev',
    } as never;

    await expect(controller.reserveManaged(body)).resolves.toEqual({
      id: 'managed-domain',
    });
    expect(service.reserveManagedDomain).toHaveBeenCalledWith(body);
  });

  it('reserves custom domains through the service', async () => {
    const controller = new DomainsController(service);
    const body = {
      deploymentTargetId: 'target-1',
      hostname: 'api.customer.test',
      expectedTarget: 'edge.itsandbox.site',
    };

    await expect(controller.reserveCustom(body)).resolves.toEqual({
      id: 'custom-domain',
    });
    expect(service.reserveCustomDomain).toHaveBeenCalledWith(body);
  });

  it('verifies domains through the service', async () => {
    const controller = new DomainsController(service);
    const body = {
      domainId: 'domain-1',
      hostname: 'api.customer.test',
      expectedTarget: 'edge.itsandbox.site',
    };

    await expect(controller.verify(body)).resolves.toEqual({
      id: 'verified-domain',
    });
    expect(service.verifyDomain).toHaveBeenCalledWith(body);
  });
});
