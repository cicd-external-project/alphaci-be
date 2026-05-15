import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return service info', () => {
      expect(appController.getServiceInfo()).toEqual({
        service: 'tribe-backend',
        version: '1.0.0',
      });
    });
  });
});
