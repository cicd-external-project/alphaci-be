import yaml from 'js-yaml';

import type { WorkflowTemplate } from '../catalog/catalog.service';
import { buildStagedWorkflowBundle } from './staged-workflow.builder';

const makeTemplate = (
  stack: WorkflowTemplate['stack'] = 'nestjs',
): WorkflowTemplate => ({
  id: 'be-nestjs',
  name: 'Backend API',
  description: 'NestJS service pipeline',
  iconName: 'server',
  categories: ['backend'],
  filePatterns: ['**/*.ts'],
  stack,
  propertiesPath: '/properties.json',
  workflowPath: '/template.yml',
});

interface ParsedWorkflow {
  name: string;
  on: {
    workflow_run?: { workflows: string[] };
  };
  jobs: Record<
    string,
    { if?: string; with?: Record<string, unknown> } | undefined
  >;
}

describe('buildStagedWorkflowBundle', () => {
  it('emits the three-stage bundle with unsuffixed names and paths by default', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    expect(bundle.workflowFiles.map((file) => file.path)).toEqual([
      '.github/workflows/00-flowci-access.yml',
      '.github/workflows/10-flowci-quality.yml',
      '.github/workflows/20-flowci-package.yml',
    ]);
    expect(bundle.workflowFiles.map((file) => file.name)).toEqual([
      'FlowCI Access Gate',
      'FlowCI Quality',
      'FlowCI Package',
    ]);
  });

  it('suffixes paths and workflow names for a variant so slots do not collide', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      servicePath: 'backend',
      workflowVariant: 'backend',
    });

    expect(bundle.workflowFiles.map((file) => file.path)).toEqual([
      '.github/workflows/00-flowci-access-backend.yml',
      '.github/workflows/10-flowci-quality-backend.yml',
      '.github/workflows/20-flowci-package-backend.yml',
    ]);

    const quality = yaml.load(bundle.workflowFiles[1]!.yaml) as ParsedWorkflow;
    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;

    expect(quality.name).toBe('FlowCI Quality (backend)');
    expect(quality.on.workflow_run?.workflows).toEqual([
      'FlowCI Access Gate (backend)',
    ]);
    expect(pkg.name).toBe('FlowCI Package (backend)');
    expect(pkg.on.workflow_run?.workflows).toEqual([
      'FlowCI Quality (backend)',
    ]);
  });

  it('produces disjoint file sets for backend and frontend variants', () => {
    const backend = buildStagedWorkflowBundle(makeTemplate('nestjs'), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      workflowVariant: 'backend',
    });
    const frontend = buildStagedWorkflowBundle(makeTemplate('nextjs'), {
      templateId: 'fe-nextjs',
      serviceName: 'orders-web',
      workflowVariant: 'frontend',
    });

    const backendPaths = new Set(backend.workflowFiles.map((f) => f.path));
    for (const file of frontend.workflowFiles) {
      expect(backendPaths.has(file.path)).toBe(false);
    }
  });

  it('normalizes trailing slashes in servicePath for working-directory inputs', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      servicePath: 'backend/',
    });

    const quality = yaml.load(bundle.workflowFiles[1]!.yaml) as ParsedWorkflow;
    expect(quality.jobs['backend-tests']?.with?.['working-directory']).toBe(
      'backend',
    );
    expect(quality.jobs['lint']?.with?.['working-directory']).toBe('backend');
  });

  it('selects the backend or frontend test workflow based on the template stack', () => {
    const backend = buildStagedWorkflowBundle(makeTemplate('nodejs'), {
      templateId: 'be-nodejs',
      serviceName: 'orders-api',
    });
    const frontend = buildStagedWorkflowBundle(makeTemplate('react'), {
      templateId: 'fe-react',
      serviceName: 'orders-web',
    });

    expect(backend.workflowFiles[1]!.yaml).toContain('backend-tests.yml@v1');
    expect(frontend.workflowFiles[1]!.yaml).toContain('frontend-tests.yml@v1');
  });

  it('only allows Vercel deployment jobs from protected branches', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate('nextjs'), {
      templateId: 'fe-nextjs',
      serviceName: 'orders-web',
      deploymentTargets: [
        {
          slot: 'frontend',
          provider: 'vercel',
          deploymentStrategy: 'vercel_ci_pushed',
          secretNames: {
            token: 'VERCEL_FRONTEND_TOKEN',
            orgId: 'VERCEL_FRONTEND_ORG_ID',
            projectId: 'VERCEL_FRONTEND_PROJECT_ID',
          },
        },
      ],
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;

    expect(pkg.jobs['deploy-vercel-frontend']?.if).toContain(
      'github.event.workflow_run.head_branch',
    );
    expect(pkg.jobs['deploy-vercel-frontend']?.if).toContain(
      '["test","uat","main"]',
    );
    expect(pkg.jobs['deploy-vercel-frontend']?.with?.['source-branch']).toBe(
      '${{ github.event.workflow_run.head_branch || github.ref_name }}',
    );
  });

  it('only allows Render deployment jobs from protected branches', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate('nestjs'), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      deploymentProvider: 'render',
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;

    expect(pkg.jobs['deploy-render']?.if).toContain(
      'github.event.workflow_run.head_branch',
    );
    expect(pkg.jobs['deploy-render']?.if).toContain('["test","uat","main"]');
  });
});
