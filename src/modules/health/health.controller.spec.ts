import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller.js';

const makeConfig = () =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      templates: {
        repoPath: 'ImplementSprint/central-workflow',
        workflowDir: '.github/workflows',
      },
    }),
  }) as unknown as ConfigService;

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ConfigService, useValue: makeConfig() }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('returns status ok with templateSource', () => {
      const result = controller.getHealth();

      expect(result.status).toBe('ok');
      expect(result.templateSource).toBe(
        'ImplementSprint/central-workflow/.github/workflows',
      );
    });

    it('returns a valid ISO timestamp', () => {
      const result = controller.getHealth();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
