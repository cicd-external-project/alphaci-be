import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from './catalog.service.js';

jest.mock('node:fs/promises');

import * as fs from 'node:fs/promises';

const mockFs = fs as jest.Mocked<typeof fs>;

const makeConfigService = () =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      templates: {
        repoPath: '/templates',
        workflowDir: 'workflow-templates',
      },
    }),
  }) as unknown as ConfigService;

const makeEntry = (name: string) =>
  ({
    name,
    isFile: () => true,
    isDirectory: () => false,
  } as unknown as import('node:fs').Dirent);

const sampleProperties = JSON.stringify({
  name: 'NestJS Backend Pipeline',
  description: 'CI/CD for NestJS',
  iconName: 'octicon package',
  categories: ['Backend', 'NestJS'],
  filePatterns: ['**/*.ts'],
});

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  describe('listTemplates', () => {
    it('throws ServiceUnavailableException when template folder does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      await expect(service.listTemplates()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('returns empty array when no property files exist', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as unknown as import('node:fs').Dirent[]);

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('loads and returns templates from property files', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const result = await service.listTemplates();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'nestjs-be',
        name: 'NestJS Backend Pipeline',
        stack: 'nestjs',
        categories: ['Backend', 'NestJS'],
      });
    });

    it('skips templates whose workflow file does not exist', async () => {
      mockFs.access
        .mockResolvedValueOnce(undefined)  // root folder
        .mockRejectedValueOnce(new Error('ENOENT')); // workflow file missing
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('skips templates with malformed JSON in properties file', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('bad-template.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue('not json' as unknown as Buffer);

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('returns cached results on second call within TTL', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      await service.listTemplates();
      await service.listTemplates();

      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
    });

    it('filters by stack', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const result = await service.listTemplates({ stack: 'nextjs' });
      expect(result).toEqual([]);
    });

    it('filters by category', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const result = await service.listTemplates({ category: 'nestjs' });
      expect(result).toHaveLength(1);
    });

    it('filters by search query', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const matchResult = await service.listTemplates({ q: 'nestjs' });
      expect(matchResult).toHaveLength(1);
    });
  });

  describe('listCategories', () => {
    it('returns categories sorted by count desc then name asc', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const result = await service.listCategories();

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('count');
    });
  });

  describe('getTemplateById', () => {
    it('returns the template when found', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        makeEntry('nestjs-be.properties.json'),
      ] as unknown as import('node:fs').Dirent[]);
      mockFs.readFile.mockResolvedValue(sampleProperties as unknown as Buffer);

      const result = await service.getTemplateById('nestjs-be');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('nestjs-be');
    });

    it('returns null when template not found', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as unknown as import('node:fs').Dirent[]);

      const result = await service.getTemplateById('missing');
      expect(result).toBeNull();
    });
  });
});
