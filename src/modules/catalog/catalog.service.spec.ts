import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from './catalog.service.js';

jest.mock('node:fs/promises');
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockSyncFs = syncFs as jest.Mocked<typeof syncFs>;

const makeConfigService = (repoPath = '/templates') =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      templates: {
        repoPath,
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

const currentRepoShapes = [
  {
    id: 'single-app',
    label: 'Single App',
    enabled: true,
    description: 'One repository contains one app or service.',
  },
  {
    id: 'monorepo',
    label: 'Monorepo',
    enabled: false,
    description: 'One repository contains multiple services or packages.',
  },
];

const currentProjectTypes = [
  {
    id: 'nextjs-app',
    label: 'Next.js App',
    runtime: 'node',
    language: 'typescript',
    framework: 'nextjs',
    starterPath: 'starter-templates/nextjs-app',
    repoShapes: ['single-app'],
    reservedRepoShapes: ['monorepo'],
    defaultRecipe: 'frontend-standard-ci',
    allowedRecipes: ['frontend-standard-ci'],
    defaultOptions: {
      lint: true,
      unit: true,
      build: true,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
  },
  {
    id: 'react-spa',
    label: 'React SPA',
    runtime: 'node',
    language: 'typescript',
    framework: 'react',
    starterPath: 'starter-templates/react-spa',
    repoShapes: ['single-app'],
    reservedRepoShapes: ['monorepo'],
    defaultRecipe: 'frontend-standard-ci',
    allowedRecipes: ['frontend-standard-ci'],
    defaultOptions: {
      lint: true,
      unit: true,
      build: true,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
  },
  {
    id: 'nestjs-api',
    label: 'NestJS API',
    runtime: 'node',
    language: 'typescript',
    framework: 'nestjs',
    starterPath: 'starter-templates/nestjs-api',
    repoShapes: ['single-app'],
    reservedRepoShapes: ['monorepo'],
    defaultRecipe: 'backend-api-ci',
    allowedRecipes: ['backend-api-ci'],
    defaultOptions: {
      lint: true,
      unit: true,
      build: false,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
  },
  {
    id: 'nodejs-api',
    label: 'Node.js API',
    runtime: 'node',
    language: 'javascript',
    framework: 'nodejs',
    starterPath: 'starter-templates/nodejs-api',
    repoShapes: ['single-app'],
    reservedRepoShapes: ['monorepo'],
    defaultRecipe: 'backend-api-ci',
    allowedRecipes: ['backend-api-ci'],
    defaultOptions: {
      lint: true,
      unit: true,
      build: false,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
  },
];

const currentRecipes = [
  {
    id: 'frontend-standard-ci',
    label: 'Frontend Standard CI',
    description: 'Validate and build frontend apps.',
    supportedProjectTypes: ['nextjs-app', 'react-spa'],
    templateByProjectType: {
      'nextjs-app': 'fe-nextjs',
      'react-spa': 'fe-react',
    },
    mandatoryJobs: ['validate-access'],
    supportedOptions: {
      lint: true,
      unit: true,
      build: true,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
    optionJobs: {
      lint: 'lint',
      unit: 'unit-tests',
      build: 'build',
      coverage: 'unit-tests',
      security: 'security',
      docker: 'docker',
    },
  },
  {
    id: 'backend-api-ci',
    label: 'Backend API CI',
    description: 'Validate and test backend APIs.',
    supportedProjectTypes: ['nestjs-api', 'nodejs-api'],
    templateByProjectType: {
      'nestjs-api': 'be-nestjs',
      'nodejs-api': 'be-nodejs',
    },
    mandatoryJobs: ['validate-access'],
    supportedOptions: {
      lint: true,
      unit: true,
      build: false,
      coverage: true,
      security: true,
      docker: true,
      e2e: false,
    },
    optionJobs: {
      lint: 'lint',
      unit: 'unit-tests',
      coverage: 'unit-tests',
      security: 'security',
      docker: 'docker',
    },
  },
];

const validStarterKit = (overrides: Record<string, unknown> = {}) => ({
  id: 'react-starter-kit',
  label: 'React Starter Kit',
  description: 'A clean React starter.',
  repo: 'Alpha-Explora/alphaexplora-react-starter-kit',
  projectType: 'react-spa',
  repoShape: 'single-app',
  language: 'typescript',
  framework: 'react',
  defaultWorkingDirectory: '.',
  workflowTiming: 'after-template',
  containsWorkflows: false,
  defaultRecipesByPlan: {
    solo: 'frontend-checks',
    plus: 'frontend-code-quality',
    pro: 'frontend-release',
  },
  ...overrides,
});

const currentStarterKits = [
  validStarterKit(),
  validStarterKit({
    id: 'nextjs-starter-kit',
    label: 'Next.js Starter Kit',
    repo: 'Alpha-Explora/alphaexplora-nextjs-starter-kit',
    projectType: 'nextjs-app',
    framework: 'nextjs',
  }),
  validStarterKit({
    id: 'nodejs-starter-kit',
    label: 'Node.js Starter Kit',
    repo: 'Alpha-Explora/alphaexplora-nodejs-starter-kit',
    projectType: 'nodejs-api',
    language: 'javascript',
    framework: 'nodejs',
    defaultRecipesByPlan: {
      solo: 'backend-checks',
      plus: 'backend-code-quality',
      pro: 'backend-release',
    },
  }),
  validStarterKit({
    id: 'nestjs-starter-kit',
    label: 'NestJS Starter Kit',
    repo: 'Alpha-Explora/alphaexplora-nestjs-starter-kit',
    projectType: 'nestjs-api',
    framework: 'nestjs',
    defaultRecipesByPlan: {
      solo: 'backend-checks',
      plus: 'backend-code-quality',
      pro: 'backend-release',
    },
  }),
];

const mockCurrentProjectOptionsCatalog = ({
  repoShapes = currentRepoShapes,
  projectTypes = currentProjectTypes,
  recipes = currentRecipes,
  starterKits = [],
}: {
  repoShapes?: Array<Record<string, unknown>>;
  projectTypes?: Array<Record<string, unknown>>;
  recipes?: Array<Record<string, unknown>>;
  starterKits?: Array<Record<string, unknown>>;
} = {}) => {
  mockSyncFs.readFileSync.mockImplementation((path) => {
    const normalized = String(path).replaceAll('\\', '/');
    if (normalized.endsWith('/catalog/project-types.json')) {
      return JSON.stringify({ schemaVersion: 1, repoShapes, projectTypes });
    }
    if (normalized.endsWith('/catalog/workflow-recipes.json')) {
      return JSON.stringify({ schemaVersion: 1, recipes });
    }
    if (normalized.endsWith('/catalog/starter-kits.json')) {
      return JSON.stringify({ schemaVersion: 1, starterKits });
    }
    throw new Error(`Unexpected catalog read: ${normalized}`);
  });
};
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
    mockSyncFs.existsSync.mockReturnValue(true);
  });

  describe('getProjectOptions', () => {
    it('loads project options from the current engine catalog files', () => {
      mockCurrentProjectOptionsCatalog({ starterKits: currentStarterKits });

      const result = service.getProjectOptions();

      expect(result.repoShapes.map((shape) => shape.id)).toEqual([
        'single-app',
        'monorepo',
      ]);
      expect(result.projectTypes.map((projectType) => projectType.id)).toEqual([
        'nextjs-app',
        'react-spa',
        'nestjs-api',
        'nodejs-api',
      ]);
      expect(result.recipes.map((recipe) => recipe.id)).toEqual([
        'frontend-standard-ci',
        'backend-api-ci',
      ]);
      expect(result.nodeVersions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: '20' }),
          expect.objectContaining({ value: '22' }),
          expect.objectContaining({ value: '24' }),
        ]),
      );
    });

    it('loads the current four starter kits from the engine catalog', () => {
      mockCurrentProjectOptionsCatalog({ starterKits: currentStarterKits });

      const result = service.getProjectOptions();

      expect(result.starterKits).toHaveLength(4);
      expect(result.starterKits.map((kit) => kit.id)).toEqual([
        'react-starter-kit',
        'nextjs-starter-kit',
        'nodejs-starter-kit',
        'nestjs-starter-kit',
      ]);
      expect(result.starterKits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'react-starter-kit',
            projectType: 'react-spa',
            repoShape: 'single-app',
          }),
        ]),
      );
    });

    it('drops malformed starter kits from the engine catalog', () => {
      mockCurrentProjectOptionsCatalog({
        starterKits: [
          validStarterKit(),
          validStarterKit({
            id: 'malformed-starter-kit',
            framework: undefined,
            defaultRecipesByPlan: { solo: 'frontend-standard-ci' },
          }),
        ],
      });

      const result = service.getProjectOptions();

      expect(result.starterKits.map((kit) => kit.id)).toEqual([
        'react-starter-kit',
      ]);
    });

    it('keeps current catalog ids when project types and repo shapes resolve', () => {
      mockCurrentProjectOptionsCatalog({
        starterKits: [
          validStarterKit({
            projectType: 'react-spa',
            repoShape: 'single-app',
          }),
        ],
      });

      const result = service.getProjectOptions();

      expect(result.starterKits).toEqual([
        expect.objectContaining({
          id: 'react-starter-kit',
          projectType: 'react-spa',
          repoShape: 'single-app',
        }),
      ]);
    });

    it('returns starter kit recipe ids that resolve to returned recipes', () => {
      mockCurrentProjectOptionsCatalog({ starterKits: currentStarterKits });

      const result = service.getProjectOptions();
      const returnedRecipeIds = new Set(
        result.recipes.map((recipe) => recipe.id),
      );

      for (const starterKit of result.starterKits) {
        expect(
          Object.values(starterKit.defaultRecipesByPlan).every((recipeId) =>
            returnedRecipeIds.has(recipeId),
          ),
        ).toBe(true);
      }
      expect(result.starterKits[0]?.defaultRecipesByPlan).toEqual({
        solo: 'frontend-standard-ci',
        plus: 'frontend-standard-ci',
        pro: 'frontend-standard-ci',
      });
      expect(result.starterKits[2]?.defaultRecipesByPlan).toEqual({
        solo: 'backend-api-ci',
        plus: 'backend-api-ci',
        pro: 'backend-api-ci',
      });
    });

    it('falls back to static project options when current catalog files cannot be read', () => {
      mockSyncFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = service.getProjectOptions();

      expect(result.projectTypes.map((projectType) => projectType.id)).toEqual(
        expect.arrayContaining(['nextjs', 'nestjs']),
      );
      expect(result.starterKits).toEqual([]);
    });

    it('resolves relative template repo paths from the backend working directory first', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CatalogService,
          {
            provide: ConfigService,
            useValue: makeConfigService('../cicd-workflow'),
          },
        ],
      }).compile();
      service = module.get(CatalogService);

      mockSyncFs.existsSync.mockImplementation((path) =>
        String(path).replaceAll('\\', '/').endsWith('/cicd-workflow'),
      );
      mockCurrentProjectOptionsCatalog({ starterKits: [] });

      expect(service.getProjectOptions().projectTypes[0]?.id).toBe('nextjs-app');
      expect(mockSyncFs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('project-types.json'),
        'utf8',
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
