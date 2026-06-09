import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { CapabilitiesController } from './capabilities.controller';

const makeConfig = (enabled: boolean) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        enabled,
      },
    }),
  }) as unknown as ConfigService;

describe('CapabilitiesController', () => {
  it('reports env provisioning enabled capabilities', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [{ provide: ConfigService, useValue: makeConfig(true) }],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: true,
        providers: ['render', 'vercel'],
        environments: ['test', 'uat', 'production'],
        modes: ['byo', 'flowci_managed'],
      },
    });
  });

  it('reports env provisioning disabled without provider lists', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [{ provide: ConfigService, useValue: makeConfig(false) }],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: false,
        providers: [],
        environments: [],
        modes: [],
      },
    });
  });
});
