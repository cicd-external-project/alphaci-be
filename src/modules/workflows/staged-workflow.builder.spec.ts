import yaml from 'js-yaml';

import type { WorkflowTemplate } from '../catalog/catalog.service';
import {
  buildStagedWorkflowBundle,
  resolvePlatformBaseUrl,
} from './staged-workflow.builder';

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
  permissions?: Record<string, string>;
  on: {
    workflow_run?: { workflows: string[] };
  };
  jobs: Record<
    string,
    | {
        if?: string;
        needs?: string[];
        uses?: string;
        with?: Record<string, unknown>;
        secrets?: Record<string, string> | string;
      }
    | undefined
  >;
}

describe('buildStagedWorkflowBundle', () => {
  it('resolves platform callback URLs from deployment configuration', () => {
    expect(
      resolvePlatformBaseUrl({
        PLATFORM_PUBLIC_URL: 'https://alphaci-api.example.com/api/v1/',
      }),
    ).toBe('https://alphaci-api.example.com');

    expect(
      resolvePlatformBaseUrl({
        GITHUB_CALLBACK_URL:
          'https://alphaci-api.example.com/api/v1/auth/github/callback',
      }),
    ).toBe('https://alphaci-api.example.com');

    expect(resolvePlatformBaseUrl({})).toBe('http://localhost:4000');
  });

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

  it('includes a best-effort report-results job in every stage', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    for (const file of bundle.workflowFiles) {
      const wf = yaml.load(file.yaml) as ParsedWorkflow;
      const reportJob = wf.jobs['report-results'];

      expect(reportJob).toBeDefined();
      // must always run, even on failure or cancellation
      expect(reportJob?.if).toBe('${{ always() }}');
    }

    // access: only needs validate-access
    const access = yaml.load(bundle.workflowFiles[0]!.yaml) as ParsedWorkflow;
    expect(access.jobs['report-results']?.needs).toEqual(['validate-access']);

    // quality: needs every substantive quality job
    const quality = yaml.load(bundle.workflowFiles[1]!.yaml) as ParsedWorkflow;
    expect(quality.jobs['report-results']?.needs).toContain('backend-tests');
    expect(quality.jobs['report-results']?.needs).toContain('sonar');

    // package: needs validate-access + build
    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    expect(pkg.jobs['report-results']?.needs).toEqual([
      'validate-access',
      'build',
    ]);
  });

  it('quality report step reads coverage from upstream job outputs, not local files', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    const qualityYaml = bundle.workflowFiles[1]!.yaml;
    // test job must still emit a JSON summary (consumed by the test runner itself)
    expect(qualityYaml).toContain('--json');
    expect(qualityYaml).toContain('--outputFile=test-results.json');
    // report step must read coverage from the upstream test job output and branch-policy output,
    // not parse local coverage-summary.json (which does not exist on the fresh report runner)
    expect(qualityYaml).toContain(
      'needs.backend-tests.outputs.coverage-percent',
    );
    expect(qualityYaml).toContain(
      'needs.branch-policy.outputs.coverage-threshold',
    );
    // must NOT reference the dead local file path
    expect(qualityYaml).not.toContain('coverage/coverage-summary.json');
    // payload must be built with jq, not a heredoc interpolating context values
    expect(qualityYaml).toContain('jq -n');
    // curl must POST to CI_REPORT_URL with CI_TOKEN
    expect(qualityYaml).toContain('CI_REPORT_URL');
    expect(qualityYaml).toContain('CI_TOKEN');
  });

  it('all three stages expose CI_REPORT_URL in env and curl uses it', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    for (const file of bundle.workflowFiles) {
      expect(file.yaml).toContain('CI_REPORT_URL');
      // graceful degradation: curl failure must not fail the pipeline
      expect(file.yaml).toContain(
        '|| echo "::warning::Failed to report pipeline results to FlowCI"',
      );
    }
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

  it('resolves per-branch governance through the branch-policy job', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      coverageThreshold: 80,
    });

    const quality = yaml.load(bundle.workflowFiles[1]!.yaml) as ParsedWorkflow;
    const policy = bundle.workflowFiles[1]!.yaml;

    // strict profile (uat/main) bumps coverage by 10; baseline stays at 80
    expect(policy).toContain('COVERAGE_THRESHOLD=90');
    expect(policy).toContain('COVERAGE_THRESHOLD=80');
    // branch resolution must use the originating branch, not ref_name alone
    expect(policy).toContain(
      'github.event.workflow_run.head_branch || github.ref_name',
    );

    expect(quality.jobs['backend-tests']?.with?.['coverage-threshold']).toBe(
      '${{ fromJson(needs.branch-policy.outputs.coverage-threshold) }}',
    );
    expect(quality.jobs['lint']?.with?.['fail-on-warning']).toBe(
      '${{ fromJson(needs.branch-policy.outputs.fail-on-warning) }}',
    );
  });

  it('caps the strict coverage threshold at 95', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      coverageThreshold: 92,
    });

    expect(bundle.workflowFiles[1]!.yaml).toContain('COVERAGE_THRESHOLD=95');
  });

  it('adds a secret-gated SonarCloud job that consumes the coverage artifact', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    const quality = yaml.load(bundle.workflowFiles[1]!.yaml) as ParsedWorkflow;
    const sonar = quality.jobs['sonar'];

    expect(sonar?.uses).toBe(
      'cicd-external-project/cicd-workflow/.github/workflows/sonarcloud-scan.yml@v1',
    );
    expect(sonar?.if).toBe(
      "${{ needs.branch-policy.outputs.sonar-enabled == 'true' }}",
    );
    expect(sonar?.needs).toEqual(['branch-policy', 'backend-tests']);
    expect(sonar?.with?.['coverage-artifact-name']).toBe('orders-api-coverage');
    expect(sonar?.secrets).toEqual({
      SONAR_TOKEN: '${{ secrets.SONAR_TOKEN }}',
      SONAR_PROJECT_KEY: '${{ secrets.SONAR_PROJECT_KEY }}',
      SONAR_ORGANIZATION: '${{ secrets.SONAR_ORGANIZATION }}',
    });
    // sonar needs lcov in the coverage artifact
    expect(quality.jobs['backend-tests']?.with?.['test-command']).toContain(
      '--coverageReporters=lcov',
    );
  });

  it('gates main behind the production-gate job in the package stage', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      enhancements: ['strictProductionApproval'],
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const gate = pkg.jobs['production-gate'];

    expect(gate?.uses).toBe(
      'cicd-external-project/cicd-workflow/.github/workflows/production-gate.yml@v1',
    );
    expect(gate?.if).toBe(
      "${{ (github.event.workflow_run.head_branch || github.ref_name) == 'main' }}",
    );
    expect(gate?.with?.['app-type']).toBe('api');
    expect(gate?.with?.['require-approval']).toBe(true);
  });

  it('deploys Vercel previews on test and uat, production on gated main', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate('nextjs'), {
      templateId: 'fe-nextjs',
      serviceName: 'orders-web',
      deploymentTargets: [
        {
          slot: 'standalone',
          provider: 'vercel',
          deploymentStrategy: 'vercel_ci_pushed',
          secretNames: {
            token: 'VERCEL_TOKEN_STANDALONE',
            orgId: 'VERCEL_ORG_ID_STANDALONE',
            projectId: 'VERCEL_PROJECT_ID_STANDALONE',
          },
        },
      ],
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const deploy = pkg.jobs['deploy-vercel-standalone'];

    expect(deploy?.needs).toEqual(['build', 'production-gate']);
    // all three branches deploy; main additionally requires the production gate
    expect(deploy?.if).toContain("== 'test'");
    expect(deploy?.if).toContain("== 'uat'");
    expect(deploy?.if).toContain("needs.production-gate.result == 'success'");
    expect(deploy?.with?.['environment']).toBe(
      "${{ (github.event.workflow_run.head_branch || github.ref_name) == 'main' && 'production' || 'preview' }}",
    );
  });

  it('maps render deploys to per-branch environments with main gated', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      deploymentProvider: 'render',
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const deploy = pkg.jobs['deploy-render'];

    expect(deploy?.needs).toEqual(['build', 'production-gate']);
    expect(deploy?.if).toContain("== 'test'");
    expect(deploy?.if).toContain("needs.production-gate.result == 'success'");
    expect(deploy?.with?.['environment']).toBe(
      "${{ (github.event.workflow_run.head_branch || github.ref_name) == 'main' && 'production' || (github.event.workflow_run.head_branch || github.ref_name) }}",
    );
  });

  it('generates GCP Cloud Run deploy jobs without legacy provider or JSON key secrets', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      servicePath: 'backend',
      deploymentTargets: [
        {
          slot: 'backend',
          provider: 'gcp',
          deploymentStrategy: 'gcp_cloud_run',
          rootDirectory: 'backend',
          dockerContext: '.',
          dockerfilePath: 'Dockerfile',
          imageName: 'orders-api',
          gcpProjectId: 'alphaci-runtime',
          gcpRegion: 'asia-southeast1',
          workloadIdentityProvider:
            'projects/123/locations/global/workloadIdentityPools/github/providers/github',
          deployerServiceAccount:
            'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
          runtimeServiceAccount:
            'orders-api-runtime@alphaci-runtime.iam.gserviceaccount.com',
          artifactRegistryRepository: 'alphaci-services',
          cloudRunServiceName: 'orders-api-dev',
        },
      ],
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const deploy = pkg.jobs['deploy-gcp-backend'];
    const packageYaml = bundle.workflowFiles[2]!.yaml;

    expect(pkg.permissions).toEqual(
      expect.objectContaining({
        contents: 'read',
        packages: 'write',
        'id-token': 'write',
      }),
    );
    expect(deploy?.needs).toEqual(['build', 'production-gate']);
    expect(deploy?.uses).toBe(
      'cicd-external-project/cicd-workflow/.github/workflows/gcp-cloud-run-deploy.yml@v1',
    );
    expect(deploy?.if).toContain("== 'test'");
    expect(deploy?.if).toContain("needs.production-gate.result == 'success'");
    expect(deploy?.with).toEqual(
      expect.objectContaining({
        'system-name': 'backend',
        'working-directory': 'backend',
        'checkout-ref':
          '${{ github.event.workflow_run.head_sha || github.sha }}',
        'source-branch':
          '${{ github.event.workflow_run.head_branch || github.ref_name }}',
        environment:
          "${{ (github.event.workflow_run.head_branch || github.ref_name) == 'main' && 'prod' || (github.event.workflow_run.head_branch || github.ref_name) == 'uat' && 'uat' || 'dev' }}",
        'gcp-project-id': 'alphaci-runtime',
        'gcp-region': 'asia-southeast1',
        'workload-identity-provider':
          'projects/123/locations/global/workloadIdentityPools/github/providers/github',
        'deployer-service-account':
          'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
        'runtime-service-account':
          'orders-api-runtime@alphaci-runtime.iam.gserviceaccount.com',
        'artifact-registry-repository': 'alphaci-services',
        'image-name': 'orders-api',
        'cloud-run-service-name': 'orders-api-dev',
        'docker-context': '.',
        'dockerfile-path': 'Dockerfile',
        'allow-preview': false,
      }),
    );
    expect(packageYaml).not.toContain('VERCEL_TOKEN');
    expect(packageYaml).not.toContain('RENDER_API_KEY');
    expect(packageYaml).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(packageYaml).not.toContain('service_account_key');
  });

  it('creates promotion PR jobs for test→uat and uat→main', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const toUat = pkg.jobs['promote-to-uat'];
    const toMain = pkg.jobs['promote-to-main'];

    expect(toUat?.uses).toBe(
      'cicd-external-project/cicd-workflow/.github/workflows/promotion.yml@v1',
    );
    expect(toUat?.needs).toEqual(['build']);
    expect(toUat?.if).toContain("== 'test'");
    expect(toUat?.with?.['direction']).toBe('test-to-uat');
    expect(toUat?.with?.['system1-name']).toBe('orders-api');
    expect(toUat?.secrets).toEqual({
      PR_TOKEN:
        "${{ secrets.GH_PR_TOKEN != '' && secrets.GH_PR_TOKEN || github.token }}",
    });

    expect(toMain?.if).toContain("== 'uat'");
    expect(toMain?.with?.['direction']).toBe('uat-to-main');
  });

  it('makes promotion wait on deploy jobs, tolerating skips', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      deploymentProvider: 'render',
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const toUat = pkg.jobs['promote-to-uat'];

    expect(toUat?.needs).toEqual(['build', 'deploy-render']);
    expect(toUat?.if).toContain(
      "(needs.deploy-render.result == 'success' || needs.deploy-render.result == 'skipped')",
    );
  });
  it('generates a bounded GCP pull request preview deploy job when previews are enabled', () => {
    const bundle = buildStagedWorkflowBundle(makeTemplate(), {
      templateId: 'be-nestjs',
      serviceName: 'orders-api',
      servicePath: 'backend',
      deploymentTargets: [
        {
          slot: 'backend',
          provider: 'gcp',
          deploymentStrategy: 'gcp_cloud_run',
          rootDirectory: 'backend',
          imageName: 'orders-api',
          gcpProjectId: 'alphaci-runtime',
          gcpRegion: 'asia-southeast1',
          workloadIdentityProvider:
            'projects/123/locations/global/workloadIdentityPools/github/providers/github',
          deployerServiceAccount:
            'alphaci-deployer@alphaci-runtime.iam.gserviceaccount.com',
          runtimeServiceAccount:
            'orders-api-runtime@alphaci-runtime.iam.gserviceaccount.com',
          artifactRegistryRepository: 'alphaci-services',
          cloudRunServiceName: 'orders-api-dev',
          allowPreview: true,
        },
      ],
    });

    const pkg = yaml.load(bundle.workflowFiles[2]!.yaml) as ParsedWorkflow;
    const previewDeploy = pkg.jobs['deploy-gcp-preview-backend'];

    expect(previewDeploy?.needs).toEqual(['build']);
    expect(previewDeploy?.if).toContain("workflow_run.event == 'pull_request'");
    expect(previewDeploy?.uses).toBe(
      'cicd-external-project/cicd-workflow/.github/workflows/gcp-cloud-run-deploy.yml@v1',
    );
    expect(previewDeploy?.with).toEqual(
      expect.objectContaining({
        environment: 'preview',
        'cloud-run-service-name':
          'orders-api-dev-pr-${{ github.event.workflow_run.pull_requests[0].number }}',
        'image-name':
          'orders-api-pr-${{ github.event.workflow_run.pull_requests[0].number }}',
        'allow-preview': true,
      }),
    );
  });
});
