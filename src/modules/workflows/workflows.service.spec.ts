import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { WorkflowsService } from './workflows.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { WorkflowHistoryRepository } from '../persistence/workflow-history.repository.js';
import { OutboxRepository } from '../persistence/outbox.repository.js';
import type { WorkflowTemplate } from '../catalog/catalog.service.js';

jest.mock('node:fs/promises');
import * as fs from 'node:fs/promises';
const mockFs = fs as jest.Mocked<typeof fs>;

const baseYaml = `
name: placeholder
on:
  workflow_dispatch:
    inputs:
      service_name:
        description: Service name
        required: true
        type: string
jobs:
  pipeline:
    uses: ImplementSprint/central-workflow/.github/workflows/be-pipeline.yml@main
    with:
      service_name: placeholder
`.trim();

const fakeTemplate: WorkflowTemplate = {
  id: 'nestjs-be',
  name: 'NestJS Backend',
  description: 'CI/CD for NestJS',
  iconName: 'octicon package',
  categories: ['Backend'],
  filePatterns: ['**/*.ts'],
  stack: 'nestjs',
  propertiesPath: '/path/nestjs-be.properties.json',
  workflowPath: '/path/nestjs-be.yml',
};

const makeCatalogService = (template: WorkflowTemplate | null = fakeTemplate) =>
  ({
    getTemplateById: jest.fn().mockResolvedValue(template),
  }) as unknown as CatalogService;

const makeHistoryRepo = () =>
  ({ create: jest.fn().mockResolvedValue(undefined) }) as unknown as WorkflowHistoryRepository;

const makeOutboxRepo = () =>
  ({ publishLater: jest.fn().mockResolvedValue(undefined) }) as unknown as OutboxRepository;

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let catalogService: CatalogService;
  let historyRepo: WorkflowHistoryRepository;
  let outboxRepo: OutboxRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    catalogService = makeCatalogService();
    historyRepo = makeHistoryRepo();
    outboxRepo = makeOutboxRepo();

    mockFs.readFile.mockResolvedValue(baseYaml);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: CatalogService, useValue: catalogService },
        { provide: WorkflowHistoryRepository, useValue: historyRepo },
        { provide: OutboxRepository, useValue: outboxRepo },
      ],
    }).compile();

    service = module.get(WorkflowsService);
  });

  describe('generate', () => {
    it('throws NotFoundException when template does not exist', async () => {
      (catalogService.getTemplateById as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.generate('user-1', { templateId: 'missing', serviceName: 'my-svc' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('generates workflow YAML with substituted service name', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
      });

      expect(result.yaml).toContain('my-service');
      expect(result.metadata.templateId).toBe('nestjs-be');
      expect(result.metadata.stack).toBe('nestjs');
      expect(result.metadata.outputFileName).toBe('my-service-nestjs-be.yml');
    });

    it('saves to history and publishes outbox event', async () => {
      await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
      });

      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', templateId: 'nestjs-be' }),
      );
      expect(outboxRepo.publishLater).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'workflow.generated' }),
      );
    });

    it('applies disablePlaywright enhancement', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
        enhancements: ['disablePlaywright'],
      });

      expect(result.yaml).toContain('run-playwright: false');
      expect(result.metadata.enhancementsApplied).toContain('disablePlaywright');
    });

    it('applies disableK6 enhancement', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
        enhancements: ['disableK6'],
      });

      expect(result.yaml).toContain('run-k6: false');
    });

    it('applies enableUatApproval enhancement', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
        enhancements: ['enableUatApproval'],
      });

      expect(result.yaml).toContain('require-uat-approval: true');
    });

    it('applies strictProductionApproval enhancement', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
        enhancements: ['strictProductionApproval'],
      });

      expect(result.yaml).toContain('require-production-approval: true');
    });

    it('applies optional substitutions when provided', async () => {
      const result = await service.generate('user-1', {
        templateId: 'nestjs-be',
        serviceName: 'my-service',
        servicePath: './apps/backend',
        nodeVersion: '22',
        coverageThreshold: 90,
      });

      expect(result.metadata.substitutionsApplied).toContain('service_path.default');
      expect(result.metadata.substitutionsApplied).toContain('node_version.default');
      expect(result.metadata.substitutionsApplied).toContain('coverage_threshold.default');
    });
  });

  describe('getHistory', () => {
    it('delegates to workflow history repository', async () => {
      const entries = [
        {
          id: 'wh-1',
          createdAt: '2026-01-01T00:00:00Z',
          templateId: 'nestjs-be',
          templateName: 'NestJS Backend',
          stack: 'nestjs',
          serviceName: 'my-service',
          outputFileName: 'my-service-nestjs-be.yml',
          sourceWorkflowFile: '/path',
          sourcePropertiesFile: '/path',
          lineCount: 100,
          yaml: 'name: test',
        },
      ];

      const listByUser = jest.fn().mockResolvedValue(entries);
      (historyRepo as unknown as { listByUser: jest.Mock }).listByUser = listByUser;

      const result = await service.getHistory('user-1', 10);
      expect(result).toEqual(entries);
      expect(listByUser).toHaveBeenCalledWith('user-1', 10);
    });

    it('clamps limit to safe range', async () => {
      const listByUser = jest.fn().mockResolvedValue([]);
      (historyRepo as unknown as { listByUser: jest.Mock }).listByUser = listByUser;

      await service.getHistory('user-1', 200);
      expect(listByUser).toHaveBeenCalledWith('user-1', 100);
    });

    it('defaults limit to 25 for NaN input', async () => {
      const listByUser = jest.fn().mockResolvedValue([]);
      (historyRepo as unknown as { listByUser: jest.Mock }).listByUser = listByUser;

      await service.getHistory('user-1', NaN);
      expect(listByUser).toHaveBeenCalledWith('user-1', 25);
    });
  });
});
