import { Test, TestingModule } from '@nestjs/testing';
import { LocationController } from './location.controller.js';
import { LocationService } from './location.service.js';
import { TribeClient } from '@apicenter/sdk';

describe('LocationController', () => {
  let controller: LocationController;
  let service: LocationService;
  let tribeClientMock: Partial<TribeClient>;

  beforeEach(async () => {
    tribeClientMock = {
      geotagResolve: jest.fn().mockResolvedValue({
        status: 200,
        data: { address: '123 Fake St, City, Country' },
      }),
      geofenceCheck: jest.fn().mockResolvedValue({
        status: 200,
        data: { insideFence: true, fenceName: 'Default Boundary' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationController],
      providers: [
        LocationService,
        {
          provide: TribeClient,
          useValue: tribeClientMock,
        },
      ],
    }).compile();

    controller = module.get<LocationController>(LocationController);
    service = module.get<LocationService>(LocationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('resolve', () => {
    it('should call geotagResolve via service and return address info', async () => {
      const result = await controller.resolve('1.2.3.4', '14.5995', '120.9842');
      
      expect(result.data.address).toBe('123 Fake St, City, Country');
      expect(tribeClientMock.geotagResolve).toHaveBeenCalledWith({
        ip: '1.2.3.4',
        latitude: 14.5995,
        longitude: 120.9842,
      });
    });

    it('should handle undefined parameters gracefully', async () => {
      await controller.resolve();
      
      expect(tribeClientMock.geotagResolve).toHaveBeenCalledWith({});
    });
  });

  describe('checkFence', () => {
    it('should call geofenceCheck via service and return insideFence status', async () => {
      const result = await controller.checkFence({
        latitude: 14.5995,
        longitude: 120.9842,
        fenceId: 'zone-alpha'
      });
      
      expect(result.data.insideFence).toBe(true);
      expect(tribeClientMock.geofenceCheck).toHaveBeenCalledWith({
        latitude: 14.5995,
        longitude: 120.9842,
        fenceId: 'zone-alpha',
      });
    });

    it('should handle request without fenceId gracefully', async () => {
      await controller.checkFence({ latitude: 10, longitude: 20 });
      
      expect(tribeClientMock.geofenceCheck).toHaveBeenCalledWith({
        latitude: 10,
        longitude: 20,
      });
    });
  });
});
