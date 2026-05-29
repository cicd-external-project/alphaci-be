import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';

const makeConfigService = (dbUrl: string | undefined) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      supabase: { dbUrl },
    }),
  }) as unknown as ConfigService;

describe('DatabaseService', () => {
  it('sets pool to null and warns when SUPABASE_DB_URL is missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    expect(service.isEnabled()).toBe(false);
  });

  it('isEnabled returns false when pool is null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    expect(service.isEnabled()).toBe(false);
  });

  it('query throws ServiceUnavailableException when pool is null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    await expect(service.query('SELECT 1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('withClient throws ServiceUnavailableException when pool is null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    await expect(service.withClient(async () => 'x')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('close resolves without error when pool is null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    await expect(service.close()).resolves.toBeUndefined();
  });

  it('onModuleDestroy calls close', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: makeConfigService(undefined) },
      ],
    }).compile();

    const service = module.get(DatabaseService);
    const closeSpy = jest.spyOn(service, 'close').mockResolvedValue();
    await service.onModuleDestroy();
    expect(closeSpy).toHaveBeenCalled();
  });
});
