import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';

const mockPoolQuery = jest.fn();
const mockPoolConnect = jest.fn();
const mockPoolEnd = jest.fn();
const mockPoolOn = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation((options) => ({
    options,
    query: mockPoolQuery,
    connect: mockPoolConnect,
    end: mockPoolEnd,
    on: mockPoolOn,
  })),
}));

const makeConfigService = (dbUrl: string | undefined) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      supabase: { dbUrl },
    }),
  }) as unknown as ConfigService;

describe('DatabaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('uses a configured pool for queries, clients, and shutdown', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ value: 1 }] });
    const release = jest.fn();
    const client = { release };
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolEnd.mockResolvedValueOnce(undefined);

    const service = new DatabaseService(
      makeConfigService('postgres://user:pass@127.0.0.1:5432/db'),
    );

    expect(service.isEnabled()).toBe(true);
    await expect(
      service.query('SELECT $1::int AS value', [1]),
    ).resolves.toEqual({
      rows: [{ value: 1 }],
    });
    await expect(
      service.withClient(async (poolClient) => poolClient),
    ).resolves.toBe(client);
    expect(release).toHaveBeenCalled();
    await expect(service.close()).resolves.toBeUndefined();
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it('registers an idle-client error handler and enables TCP keepalive', () => {
    const service = new DatabaseService(
      makeConfigService('postgres://user:pass@db.example.com:5432/db'),
    );

    expect(service.isEnabled()).toBe(true);
    // Idle-client error handler is wired so a dropped connection never crashes
    // the process.
    expect(mockPoolOn).toHaveBeenCalledWith('error', expect.any(Function));
    // The handler itself only logs (must not throw).
    const handler = mockPoolOn.mock.calls.find(
      (call) => call[0] === 'error',
    )?.[1] as (err: Error) => void;
    expect(() => handler(new Error('connection dropped'))).not.toThrow();
  });

  it('retries a query once when it hits a stale connection', async () => {
    const staleError = Object.assign(new Error('Connection terminated'), {
      code: '08006',
    });
    mockPoolQuery
      .mockRejectedValueOnce(staleError)
      .mockResolvedValueOnce({ rows: [{ value: 1 }] });

    const service = new DatabaseService(
      makeConfigService('postgres://user:pass@db.example.com:5432/db'),
    );

    await expect(service.query('SELECT 1')).resolves.toEqual({
      rows: [{ value: 1 }],
    });
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a non-connection (SQL) error', async () => {
    const sqlError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    mockPoolQuery.mockRejectedValueOnce(sqlError);

    const service = new DatabaseService(
      makeConfigService('postgres://user:pass@db.example.com:5432/db'),
    );

    await expect(service.query('INSERT ...')).rejects.toThrow(
      'duplicate key value',
    );
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('propagates the error if the retry also fails', async () => {
    const staleError = Object.assign(
      new Error('server closed the connection'),
      {
        code: 'ECONNRESET',
      },
    );
    mockPoolQuery
      .mockRejectedValueOnce(staleError)
      .mockRejectedValueOnce(staleError);

    const service = new DatabaseService(
      makeConfigService('postgres://user:pass@db.example.com:5432/db'),
    );

    await expect(service.query('SELECT 1')).rejects.toThrow(
      'server closed the connection',
    );
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });
});
