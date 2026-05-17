import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { WorkflowHistoryRepository } from './workflow-history.repository.js';
import { DatabaseService } from '../database/database.service.js';

const fakeRow = {
  id: 'wh-1',
  created_at: '2026-01-01T00:00:00Z',
  template_id: 'nestjs-be',
  template_name: 'NestJS Backend',
  stack: 'nestjs',
  service_name: 'my-service',
  output_file_name: 'my-service-nestjs-be.yml',
  source_workflow_file: '/path/workflow.yml',
  source_properties_file: '/path/workflow.properties.json',
  line_count: 120,
  yaml: 'name: my-service',
};

const makeDatabaseService = (rows = [fakeRow]) =>
  ({
    query: jest.fn().mockResolvedValue({ rows }),
  }) as unknown as DatabaseService;

describe('WorkflowHistoryRepository', () => {
  let repo: WorkflowHistoryRepository;
  let db: DatabaseService;

  beforeEach(async () => {
    db = makeDatabaseService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowHistoryRepository,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    repo = module.get(WorkflowHistoryRepository);
  });

  it('should be defined', () => {
    expect(repo).toBeDefined();
  });

  it('create inserts a workflow generation record', async () => {
    await repo.create({
      userId: 'user-1',
      templateId: 'nestjs-be',
      templateName: 'NestJS Backend',
      stack: 'nestjs',
      serviceName: 'my-service',
      outputFileName: 'my-service-nestjs-be.yml',
      sourceWorkflowFile: '/path/workflow.yml',
      sourcePropertiesFile: '/path/workflow.properties.json',
      lineCount: 120,
      yaml: 'name: my-service',
      sha256: 'abc123',
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_generations'),
      expect.arrayContaining(['user-1', 'nestjs-be']),
    );
  });

  it('listByUser returns mapped entries', async () => {
    const result = await repo.listByUser('user-1', 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'wh-1',
      templateId: 'nestjs-be',
      templateName: 'NestJS Backend',
      stack: 'nestjs',
      serviceName: 'my-service',
      outputFileName: 'my-service-nestjs-be.yml',
      lineCount: 120,
    });
  });

  it('listByUser clamps limit to 100', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await repo.listByUser('user-1', 999);

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['user-1', 100]),
    );
  });

  it('listByUser defaults limit to 25 for invalid input', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await repo.listByUser('user-1', NaN);

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['user-1', 25]),
    );
  });
});
