import yaml from 'js-yaml';

import type { WorkflowTemplate } from '../catalog/catalog.service';
import type {
  DeploymentProvider,
  DeploymentWorkflowTarget,
  GenerateWorkflowDto,
} from './dto/generate-workflow.dto';

export type WorkflowStage = 'access' | 'quality' | 'package';

export interface StagedWorkflowFile {
  stage: WorkflowStage;
  name: string;
  path: string;
  gated: boolean;
  yaml: string;
}

export interface WorkflowFileMetadata {
  stage: WorkflowStage;
  name: string;
  path: string;
  gated: boolean;
}

export interface StagedWorkflowBundle {
  workflowFiles: StagedWorkflowFile[];
  metadata: WorkflowFileMetadata[];
}

const CENTRAL_WORKFLOW_REF =
  'cicd-external-project/cicd-workflow/.github/workflows';

const CI_VALIDATE_URL =
  'https://flowci-be-test.onrender.com/api/v1/ci/validate';

export function buildStagedWorkflowBundle(
  template: WorkflowTemplate,
  dto: GenerateWorkflowDto,
): StagedWorkflowBundle {
  const serviceName = dto.serviceName;
  const servicePath = dto.servicePath ?? '.';
  const nodeVersion = dto.nodeVersion ?? '24';
  const coverageThreshold = dto.coverageThreshold ?? 80;
  const deploymentProvider = dto.deploymentProvider;
  const deploymentTargets = dto.deploymentTargets ?? [];
  const stack = template.stack;
  const isBackend = stack === 'nestjs' || stack === 'nodejs';
  const testWorkflow = isBackend ? 'backend-tests.yml' : 'frontend-tests.yml';
  const testJobId = isBackend ? 'backend-tests' : 'frontend-tests';
  const testCommand = isBackend ? 'npm test' : 'npm run test';
  const lintCommand = 'npm run lint';

  const files: StagedWorkflowFile[] = [
    {
      stage: 'access',
      name: 'FlowCI Access Gate',
      path: '.github/workflows/00-flowci-access.yml',
      gated: true,
      yaml: dumpWorkflow({
        name: 'FlowCI Access Gate',
        on: {
          push: { branches: ['test', 'uat', 'main'] },
          pull_request: { branches: ['test', 'uat', 'main'] },
          workflow_dispatch: {},
        },
        permissions: { contents: 'read' },
        env: {
          CI_VALIDATE_URL,
        },
        jobs: {
          'validate-access': validationJob('access'),
        },
      }),
    },
    {
      stage: 'quality',
      name: 'FlowCI Quality',
      path: '.github/workflows/10-flowci-quality.yml',
      gated: true,
      yaml: dumpWorkflow({
        name: 'FlowCI Quality',
        on: {
          workflow_run: {
            workflows: ['FlowCI Access Gate'],
            types: ['completed'],
          },
          workflow_dispatch: {},
        },
        permissions: {
          contents: 'read',
          'security-events': 'write',
        },
        env: {
          CI_VALIDATE_URL,
        },
        jobs: {
          'validate-access': {
            if: "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
            ...validationJob('quality'),
          },
          [testJobId]: {
            needs: ['validate-access'],
            uses: `${CENTRAL_WORKFLOW_REF}/${testWorkflow}@v1`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              ...(isBackend ? { 'backend-stack': stack } : {}),
              'node-version': Number(nodeVersion),
              'coverage-threshold': coverageThreshold,
              'enforce-coverage': true,
              'test-command': testCommand,
              'checkout-ref':
                '${{ github.event.workflow_run.head_sha || github.sha }}',
            },
          },
          lint: {
            needs: ['validate-access'],
            uses: `${CENTRAL_WORKFLOW_REF}/lint-check.yml@v1`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              'node-version': Number(nodeVersion),
              'lint-command': lintCommand,
              'checkout-ref':
                '${{ github.event.workflow_run.head_sha || github.sha }}',
            },
          },
          security: {
            needs: ['validate-access'],
            uses: `${CENTRAL_WORKFLOW_REF}/security-scan.yml@v1`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              'node-version': Number(nodeVersion),
              'fail-on-high': true,
              'checkout-ref':
                '${{ github.event.workflow_run.head_sha || github.sha }}',
            },
          },
        },
      }),
    },
    {
      stage: 'package',
      name: 'FlowCI Package',
      path: '.github/workflows/20-flowci-package.yml',
      gated: true,
      yaml: dumpWorkflow({
        name: 'FlowCI Package',
        on: {
          workflow_run: {
            workflows: ['FlowCI Quality'],
            types: ['completed'],
          },
          workflow_dispatch: {},
        },
        permissions: {
          contents: 'read',
          packages: 'write',
        },
        env: {
          CI_VALIDATE_URL,
        },
        jobs: {
          'validate-access': {
            if: "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
            ...validationJob('package'),
          },
          build: buildJob(servicePath, nodeVersion),
          ...vercelDeployJobs(serviceName, servicePath, deploymentTargets),
          ...(deploymentProvider === 'render' && {
            'deploy-render': renderDeployJob(serviceName),
          }),
        },
      }),
    },
  ];

  return {
    workflowFiles: files,
    metadata: files.map((file) => ({
      stage: file.stage,
      name: file.name,
      path: file.path,
      gated: file.gated,
    })),
  };
}

function validationJob(stage: WorkflowStage) {
  return {
    runs_on: 'ubuntu-latest',
    steps: [
      {
        name: 'Validate FlowCI access',
        run: [
          'RESPONSE=$(curl -sf -w "\\n%{http_code}" \\',
          '  -X POST \\',
          '  -H "Authorization: Bearer ${{ secrets.CI_TOKEN }}" \\',
          '  -H "Content-Type: application/json" \\',
          '  -d "{\\"repo\\":\\"${{ github.repository }}\\",\\"stage\\":\\"' +
            stage +
            '\\",\\"workflowRunId\\":\\"${{ github.run_id }}\\",\\"headSha\\":\\"${{ github.event.workflow_run.head_sha || github.sha }}\\"}" \\',
          '  "$CI_VALIDATE_URL") || true',
          'HTTP_CODE=$(printf \'%s\' "$RESPONSE" | tail -1)',
          'BODY=$(printf \'%s\' "$RESPONSE" | head -n -1)',
          'if [ "$HTTP_CODE" != "200" ]; then',
          '  echo "::error::FlowCI authorization failed (HTTP $HTTP_CODE). ${BODY}"',
          '  exit 1',
          'fi',
          'echo "FlowCI authorization validated."',
        ].join('\n'),
      },
    ],
  };
}

function buildJob(servicePath: string, nodeVersion: string) {
  return {
    needs: ['validate-access'],
    runs_on: 'ubuntu-latest',
    defaults: {
      run: {
        'working-directory': `./${servicePath}`,
      },
    },
    steps: [
      {
        uses: 'actions/checkout@v6',
        with: {
          ref: '${{ github.event.workflow_run.head_sha || github.sha }}',
        },
      },
      {
        uses: 'actions/setup-node@v6',
        with: {
          'node-version': Number(nodeVersion),
          cache: 'npm',
          'cache-dependency-path': '**/package-lock.json',
        },
      },
      { run: 'npm ci --ignore-scripts' },
      { run: 'npm run build' },
    ],
  };
}

function vercelDeployJobs(
  serviceName: string,
  servicePath: string,
  targets: DeploymentWorkflowTarget[],
) {
  return Object.fromEntries(
    targets.map((target) => [
      `deploy-vercel-${target.slot}`,
      {
        needs: ['build'],
        uses: `${CENTRAL_WORKFLOW_REF}/vercel-deploy.yml@v1`,
        if: "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
        with: {
          'system-name':
            target.slot === 'standalone' ? serviceName : target.slot,
          'working-directory': target.rootDirectory ?? servicePath,
          'checkout-ref':
            '${{ github.event.workflow_run.head_sha || github.sha }}',
          environment:
            "${{ github.event.workflow_run.head_branch == 'main' && 'production' || 'preview' }}",
        },
        secrets: {
          VERCEL_TOKEN: `\${{ secrets.${target.secretNames.token} }}`,
          VERCEL_ORG_ID: `\${{ secrets.${target.secretNames.orgId} }}`,
          VERCEL_PROJECT_ID: `\${{ secrets.${target.secretNames.projectId} }}`,
        },
      },
    ]),
  );
}

function renderDeployJob(serviceName: string) {
  return {
    needs: ['build'],
    uses: `${CENTRAL_WORKFLOW_REF}/render-deploy.yml@v1`,
    with: {
      'system-name': serviceName,
      environment:
        "${{ github.event.workflow_run.head_branch == 'main' && 'production' || github.event.workflow_run.head_branch || github.ref_name }}",
      branch:
        '${{ github.event.workflow_run.head_branch || github.ref_name }}',
    },
    secrets: 'inherit',
  };
}

function dumpWorkflow(workflow: Record<string, unknown>): string {
  return yaml
    .dump(workflow, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    .replaceAll('runs_on:', 'runs-on:');
}
