import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from './catalog.service.js';

jest.mock('node:fs/promises');
jest.mock('node:fs', () => ({
  readFileSync: jest.fn(),
}));

import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockSyncFs = syncFs as jest.Mocked<typeof syncFs>;

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
  }) as unknown as import('node:fs').Dirent;

const mockReaddir = (entries: import('node:fs').Dirent[]) => {
  mockFs.readdir.mockResolvedValue(entries as never);
};

const mockReadFile = (value: string) => {
  mockFs.readFile.mockResolvedValue(value as never);
};

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

  describe('getProjectOptions', () => {
    it('derives project types and stable workflow refs from the engine catalog', () => {
      mockSyncFs.readFileSync.mockImplementation((path) => {
        const normalized = String(path).replaceAll('\\', '/');
        if (normalized.endsWith('/catalog/stacks.json')) {
          return JSON.stringify([
            {
              key: 'nextjs',
              label: 'Next.js',
              kind: 'frontend',
              runtime: 'node',
              masterWorkflow: 'frontendMaster',
              serviceWorkflow: 'nextjsService',
            },
            {
              key: 'nestjs',
              label: 'NestJS',
              kind: 'backend',
              runtime: 'node',
              masterWorkflow: 'backendMaster',
              serviceWorkflow: 'nestjsService',
            },
          ]);
        }

        if (normalized.endsWith('/catalog/workflow-refs.json')) {
          return JSON.stringify({
            currentStable: 'v1',
            repository: 'cicd-external-project/cicd-workflow',
            workflows: {
              frontendMaster: '.github/workflows/master-pipeline-fe.yml',
              backendMaster: '.github/workflows/master-pipeline-be.yml',
              nextjsService: '.github/workflows/service-nextjs.yml',
              nestjsService: '.github/workflows/service-nestjs.yml',
            },
          });
        }

        if (
          normalized.endsWith('/catalog/actions.json') ||
          normalized.endsWith('/catalog/providers.json') ||
          normalized.endsWith('/catalog/plans.json')
        ) {
          return '[]';
        }

        throw new Error(`Unexpected catalog read: ${normalized}`);
      });

      const result = service.getProjectOptions();

      expect(result.projectTypes.map((projectType) => projectType.id)).toEqual([
        'nextjs',
        'nestjs',
      ]);
      expect(result.recipes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'standard',
            templateByProjectType: expect.objectContaining({
              nextjs: 'nextjs-service-pipeline',
              nestjs: 'nest-service-pipeline',
            }),
            workflowRefByProjectType: expect.objectContaining({
              nextjs:
                'cicd-external-project/cicd-workflow/.github/workflows/service-nextjs.yml@v1',
              nestjs:
                'cicd-external-project/cicd-workflow/.github/workflows/service-nestjs.yml@v1',
            }),
          }),
        ]),
      );
    });

    it('falls back to static project options when engine catalog files cannot be read', () => {
      mockSyncFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = service.getProjectOptions();

      expect(result.projectTypes.map((projectType) => projectType.id)).toEqual(
        expect.arrayContaining(['nextjs', 'nestjs']),
      );
      expect(result.recipes[0]?.templateByProjectType.nextjs).toBe(
        'nextjs-service-pipeline',
      );
    });
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
      mockReaddir([]);

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('loads and returns templates from property files', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

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
        .mockResolvedValueOnce(undefined) // root folder
        .mockRejectedValueOnce(new Error('ENOENT')); // workflow file missing
      mockReaddir([makeEntry('nestjs-be.properties.json')]);

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('skips templates with malformed JSON in properties file', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('bad-template.properties.json')]);
      mockReadFile('not json');

      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });

    it('returns cached results on second call within TTL', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      await service.listTemplates();
      await service.listTemplates();

      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
    });

    it('filters by stack', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      const result = await service.listTemplates({ stack: 'nextjs' });
      expect(result).toEqual([]);
    });

    it('filters by category', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      const result = await service.listTemplates({ category: 'nestjs' });
      expect(result).toHaveLength(1);
    });

    it('filters by search query', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      const matchResult = await service.listTemplates({ q: 'nestjs' });
      expect(matchResult).toHaveLength(1);
    });
  });

  describe('listCategories', () => {
    it('returns categories sorted by count desc then name asc', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      const result = await service.listCategories();

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('count');
    });
  });

  describe('getTemplateById', () => {
    it('returns the template when found', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([makeEntry('nestjs-be.properties.json')]);
      mockReadFile(sampleProperties);

      const result = await service.getTemplateById('nestjs-be');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('nestjs-be');
    });

    it('returns null when template not found', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockReaddir([]);

      const result = await service.getTemplateById('missing');
      expect(result).toBeNull();
    });
  });
});
