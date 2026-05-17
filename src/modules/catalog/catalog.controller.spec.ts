import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import type { WorkflowTemplate } from './catalog.service.js';

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

const makeCatalogService = (): Partial<CatalogService> => ({
  listCategories: jest.fn().mockResolvedValue([{ name: 'Backend', count: 1 }]),
  listTemplates: jest.fn().mockResolvedValue([fakeTemplate]),
  getTemplateById: jest.fn().mockResolvedValue(fakeTemplate),
});

describe('CatalogController', () => {
  let controller: CatalogController;
  let service: Partial<CatalogService>;

  beforeEach(async () => {
    service = makeCatalogService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: service }],
    })
      .overrideGuard(require('../../common/guards/session-auth.guard.js').SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards/subscription.guard.js').SubscriptionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CatalogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('categories returns wrapped list', async () => {
    const result = await controller.categories();
    expect(result).toEqual({ categories: [{ name: 'Backend', count: 1 }] });
  });

  it('templates returns wrapped list', async () => {
    const result = await controller.templates({});
    expect(result).toEqual({ templates: [fakeTemplate] });
  });

  it('templateById returns wrapped template', async () => {
    const result = await controller.templateById('nestjs-be');
    expect(result).toEqual({ template: fakeTemplate });
  });

  it('templateById throws NotFoundException when template not found', async () => {
    (service.getTemplateById as jest.Mock).mockResolvedValueOnce(null);
    await expect(controller.templateById('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
