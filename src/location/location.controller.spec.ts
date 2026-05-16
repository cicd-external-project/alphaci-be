import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { LocationController } from './location.controller.js';
import { LocationService } from './location.service.js';
import { TribeClient } from '@implementsprint/sdk';

describe('LocationController', () => {
  let controller: LocationController;
  let tribeClientMock: Partial<TribeClient>;

  beforeEach(async () => {
    tribeClientMock = {
      geoReverseGeocode: jest.fn().mockResolvedValue({
        formattedAddress: '123 Fake St, City, Country',
        latitude: 14.5995,
        longitude: 120.9842,
        provider: 'google-maps',
      }),
      geoFenceCheck: jest.fn().mockResolvedValue({
        inside: true,
        distanceDetails: [],
        provider: 'local',
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
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('resolve', () => {
    it('should call geoReverseGeocode via service and return address info', async () => {
      const result = await controller.resolve('14.5995', '120.9842');

      expect(result.formattedAddress).toBe('123 Fake St, City, Country');
      expect(tribeClientMock.geoReverseGeocode).toHaveBeenCalledWith({
        latitude: 14.5995,
        longitude: 120.9842,
      });
    });
  });

  describe('checkFence', () => {
    it('should call geoFenceCheck via service and return inside status', async () => {
      const result = await controller.checkFence({
        latitude: 14.5995,
        longitude: 120.9842,
        fenceId: 'zone-alpha',
      });

      expect(result.inside).toBe(true);
      expect(tribeClientMock.geoFenceCheck).toHaveBeenCalledWith({
        latitude: 14.5995,
        longitude: 120.9842,
        fenceId: 'zone-alpha',
      });
    });

    it('should handle request without fenceId gracefully', async () => {
      await controller.checkFence({ latitude: 10, longitude: 20 });

      expect(tribeClientMock.geoFenceCheck).toHaveBeenCalledWith({
        latitude: 10,
        longitude: 20,
      });
    });
  });
});
