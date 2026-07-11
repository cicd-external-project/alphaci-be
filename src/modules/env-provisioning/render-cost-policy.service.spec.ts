import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { RenderCostPolicyService } from './render-cost-policy.service';

describe('RenderCostPolicyService', () => {
  const makeConfigService = (overrides = {}) =>
    ({
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: {
          flowciManaged: {
            renderDefaultInstanceType: 'free',
            renderDefaultRegion: 'singapore',
            renderAllowedInstanceTypes: ['free'],
            renderAllowPaidManaged: false,
            ...overrides,
          },
        },
      }),
    }) as unknown as ConfigService;

  it('resolves managed Render defaults from config', () => {
    const service = new RenderCostPolicyService(makeConfigService());

    expect(
      service.resolveDefaults({
        ownershipMode: 'flowci_managed',
      }),
    ).toEqual({
      serviceType: 'web_service',
      instanceType: 'free',
      region: 'singapore',
    });
  });

  it('uses trimmed explicit values before config defaults', () => {
    const service = new RenderCostPolicyService(makeConfigService());

    expect(
      service.resolveDefaults({
        ownershipMode: 'byo',
        serviceType: 'background_worker',
        instanceType: ' starter ',
        region: ' oregon ',
      }),
    ).toEqual({
      serviceType: 'background_worker',
      instanceType: 'starter',
      region: 'oregon',
    });
  });

  it('rejects managed instance types outside the allowed list', () => {
    const service = new RenderCostPolicyService(makeConfigService());

    expect(() =>
      service.assertManagedAllowed('web_service', 'starter'),
    ).toThrow(BadRequestException);
  });

  it('rejects free managed non-web Render service types', () => {
    const service = new RenderCostPolicyService(makeConfigService());

    expect(() =>
      service.assertManagedAllowed('background_worker', 'free'),
    ).toThrow(BadRequestException);
  });

  it('rejects managed paid provisioning when disabled', () => {
    const service = new RenderCostPolicyService(
      makeConfigService({ renderAllowedInstanceTypes: ['starter'] }),
    );

    expect(() =>
      service.assertManagedAllowed('web_service', 'starter'),
    ).toThrow(BadRequestException);
  });
});
