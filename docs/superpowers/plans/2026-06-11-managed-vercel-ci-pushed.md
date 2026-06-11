# Managed Vercel CI-Pushed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FlowCI-managed Vercel provisioning create the Vercel project automatically without requiring the Vercel GitHub App, then deploy through GitHub Actions.

**Architecture:** Managed Vercel must resolve to the existing `vercel_ci_pushed` strategy instead of `vercel_git_connected`. The backend creates the Vercel project through the Vercel API without `gitRepository`, stores the returned project/org metadata, installs per-slot GitHub Actions secrets using FlowCI-managed Vercel credentials, and generated package workflows deploy through the central `vercel-deploy.yml` reusable workflow.

**Tech Stack:** NestJS backend, Supabase/Postgres repositories, GitHub App repository secret installation, Vercel REST API, GitHub Actions reusable workflows, Next.js frontend, Jest tests, `js-yaml` workflow validation.

---

## Current Problem

The current managed Vercel path maps:

```ts
vercel + flowci_managed => vercel_git_connected
```

That causes `VercelEnvClient.createTarget()` to send:

```json
{
  "gitRepository": {
    "type": "github",
    "repo": "cicd-external-project/test12353251"
  }
}
```

Vercel rejects this unless the FlowCI-owned Vercel workspace has the Vercel GitHub integration installed for that GitHub owner/repo. That does not match the intended product behavior. The intended behavior is:

```text
FlowCI creates GitHub repo -> FlowCI creates Vercel project -> GitHub Actions deploys to Vercel
```

This requires no Vercel GitHub App installation by the user.

## Target Behavior

New default mapping:

```ts
vercel + flowci_managed => vercel_ci_pushed
vercel + byo            => vercel_ci_pushed
render + any ownership  => provider_native
```

Keep the `vercel_git_connected` type for legacy records and a future advanced mode, but do not use it for normal managed provisioning.

For managed Vercel, the backend must install these GitHub Actions secrets:

```text
VERCEL_FRONTEND_TOKEN
VERCEL_FRONTEND_ORG_ID
VERCEL_FRONTEND_PROJECT_ID
```

The same pattern applies to other slots:

```text
VERCEL_BACKEND_TOKEN
VERCEL_BACKEND_ORG_ID
VERCEL_BACKEND_PROJECT_ID

VERCEL_STANDALONE_TOKEN
VERCEL_STANDALONE_ORG_ID
VERCEL_STANDALONE_PROJECT_ID
```

---

## File Structure

### Backend

- `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.ts`
  - Owns the provider/ownership to deployment-strategy decision.
- `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.spec.ts`
  - Verifies managed Vercel now uses `vercel_ci_pushed`.
- `cicd-workflow-be/src/modules/env-provisioning/vercel-ci-secrets.service.ts`
  - Installs Vercel deploy secrets into the generated GitHub repo.
  - Must support both managed and BYO token sources.
- `cicd-workflow-be/src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts`
  - Verifies managed token secret installation and BYO compatibility.
- `cicd-workflow-be/src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts`
  - Verifies CI-pushed Vercel project creation omits `gitRepository`.
- `cicd-workflow-be/src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts`
  - Verifies managed Vercel target receives GitHub secret metadata after project creation.
- `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.spec.ts`
  - Verifies package workflow emits Vercel deploy job for managed Vercel CI-pushed targets.

### Frontend

- `cicd-workflow-fe/src/components/product/deployment-provisioning-setup.tsx`
  - Updates helper text for managed Vercel.
- `cicd-workflow-fe/src/components/product/setup-result-panel.tsx`
  - Shows `Deploys through GitHub Actions` for `vercel_ci_pushed`.
- `cicd-workflow-fe/tests/unit/deployment-provisioning-setup.test.tsx`
  - Verifies managed Vercel copy.
- `cicd-workflow-fe/tests/unit/workflow-builder-setup.test.tsx`
  - Verifies managed Vercel provisioning payload remains valid.

### Central Workflow

- `cicd-workflow/.github/workflows/vercel-deploy.yml`
  - Existing reusable workflow that deploys with Vercel CLI.
  - Expected to remain unchanged unless validation finds a contract mismatch.

---

## Task 1: Change Managed Vercel Strategy Resolution

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.ts`

- [ ] **Step 1: Update the failing resolver test**

Replace the managed Vercel expectation in `deployment-strategy.resolver.spec.ts` with:

```ts
it('uses CI-pushed Vercel deployments for FlowCI-managed Vercel targets', () => {
  expect(
    resolver.resolve({
      provider: 'vercel',
      ownershipMode: 'flowci_managed',
    }),
  ).toBe('vercel_ci_pushed');
});
```

Keep the BYO test:

```ts
it('uses CI-pushed Vercel deployments for BYO Vercel targets', () => {
  expect(
    resolver.resolve({
      provider: 'vercel',
      ownershipMode: 'byo',
    }),
  ).toBe('vercel_ci_pushed');
});
```

- [ ] **Step 2: Run the resolver test and confirm failure**

Run:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
npm test -- src/modules/env-provisioning/deployment-strategy.resolver.spec.ts --runInBand
```

Expected before implementation:

```text
Expected: "vercel_ci_pushed"
Received: "vercel_git_connected"
```

- [ ] **Step 3: Change the resolver implementation**

Update `deployment-strategy.resolver.ts` to:

```ts
@Injectable()
export class DeploymentStrategyResolver {
  resolve(input: ResolveDeploymentStrategyInput): DeploymentStrategy {
    if (input.provider === 'vercel') {
      return 'vercel_ci_pushed';
    }

    return 'provider_native';
  }
}
```

- [ ] **Step 4: Run the resolver test and confirm pass**

Run:

```powershell
npm test -- src/modules/env-provisioning/deployment-strategy.resolver.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/env-provisioning/deployment-strategy.resolver.spec.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/env-provisioning/deployment-strategy.resolver.ts src/modules/env-provisioning/deployment-strategy.resolver.spec.ts
git commit -m "fix: use ci-pushed strategy for managed vercel"
```

---

## Task 2: Verify Vercel Project Creation Omits Git Repository

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts`
- Verify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/vercel-env.client.ts`

- [ ] **Step 1: Add managed CI-pushed project creation test**

Add this test beside the existing Vercel project creation tests:

```ts
it('omits gitRepository for FlowCI-managed CI-pushed Vercel projects', async () => {
  const client = new VercelEnvClient(configService);
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: 'prj_managed', name: 'web-test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const result = await client.createTarget({
    token: 'managed-token',
    projectName: 'web-test',
    repoFullName: 'cicd-external-project/test12353251',
    rootDirectory: '.',
    buildCommand: 'npm run build',
    deploymentStrategy: 'vercel_ci_pushed',
    vercelOrgId: 'team_flowci',
    vercelTeamId: 'team_flowci',
  });

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(String(init.body))).not.toHaveProperty('gitRepository');
  expect(result.metadata).toMatchObject({
    deploymentStrategy: 'vercel_ci_pushed',
    vercelProjectId: 'prj_managed',
    vercelOrgId: 'team_flowci',
    gitConnected: false,
  });
});
```

- [ ] **Step 2: Run the Vercel client test**

Run:

```powershell
npm test -- src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts
```

- [ ] **Step 3: Confirm no implementation change is needed unless test fails**

The current implementation should already have:

```ts
const shouldConnectGit =
  input.deploymentStrategy !== 'vercel_ci_pushed' && Boolean(owner && repo);
```

If this differs, update it to exactly that condition.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/env-provisioning/provider-clients/vercel-env.client.ts src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts
git commit -m "test: cover managed vercel ci project creation"
```

---

## Task 3: Support Managed Vercel Secret Installation

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/vercel-ci-secrets.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts`

- [ ] **Step 1: Add a failing managed-secret test**

Add this test in `vercel-ci-secrets.service.spec.ts`:

```ts
it('installs managed Vercel secrets from FlowCI config without a provider connection', async () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        flowciManaged: {
          vercelToken: 'managed-vercel-token',
        },
      },
    }),
  };
  const service = new VercelCiSecretsService(
    githubService as never,
    providerConnectionsRepository as never,
    encryptionService as never,
    configService as never,
  );

  await expect(
    service.installForTarget({
      githubAccessToken: 'github-token',
      repoFullName: 'cicd-external-project/test12353251',
      userId: 'user-1',
      providerConnectionId: null,
      target: {
        id: 'target-1',
        slot: 'frontend',
        provider: 'vercel',
        ownershipMode: 'flowci_managed',
        providerProjectId: 'prj_managed',
        providerProjectName: 'web-test',
        providerMetadata: { vercelOrgId: 'team_flowci' },
        deploymentStrategy: 'vercel_ci_pushed',
        env: [],
        status: 'active',
      },
    }),
  ).resolves.toEqual({
    githubSecrets: {
      token: 'VERCEL_FRONTEND_TOKEN',
      orgId: 'VERCEL_FRONTEND_ORG_ID',
      projectId: 'VERCEL_FRONTEND_PROJECT_ID',
    },
  });

  expect(providerConnectionsRepository.findActiveProviderConnection).not.toHaveBeenCalled();
  expect(githubService.setActionsSecretStrict).toHaveBeenNthCalledWith(
    1,
    'github-token',
    'cicd-external-project',
    'test12353251',
    'VERCEL_FRONTEND_TOKEN',
    'managed-vercel-token',
  );
  expect(githubService.setActionsSecretStrict).toHaveBeenNthCalledWith(
    2,
    'github-token',
    'cicd-external-project',
    'test12353251',
    'VERCEL_FRONTEND_ORG_ID',
    'team_flowci',
  );
  expect(githubService.setActionsSecretStrict).toHaveBeenNthCalledWith(
    3,
    'github-token',
    'cicd-external-project',
    'test12353251',
    'VERCEL_FRONTEND_PROJECT_ID',
    'prj_managed',
  );
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```powershell
npm test -- src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts --runInBand
```

Expected before implementation:

```text
providerConnectionId is required for BYO Vercel deployment secrets
```

- [ ] **Step 3: Inject `ConfigService` into `VercelCiSecretsService`**

Update imports:

```ts
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/app.config';
```

Update constructor:

```ts
constructor(
  private readonly githubService: GithubService,
  private readonly providerConnectionsRepository: ProviderConnectionsRepository,
  private readonly encryptionService: EnvTokenEncryptionService,
  private readonly configService: ConfigService,
) {}
```

- [ ] **Step 4: Split token resolution by ownership mode**

Add this helper:

```ts
private async resolveVercelToken(input: InstallVercelCiSecretsInput): Promise<string> {
  if (input.target.ownershipMode === 'flowci_managed') {
    const config = this.configService.getOrThrow<AppConfig>('app');
    const token = config.envProvisioning.flowciManaged.vercelToken.trim();
    if (!token) {
      throw new InternalServerErrorException(
        'FLOWCI_VERCEL_TOKEN is required for FlowCI-managed Vercel deployments',
      );
    }
    return token;
  }

  if (!input.providerConnectionId) {
    throw new BadRequestException(
      'providerConnectionId is required for BYO Vercel deployment secrets',
    );
  }

  const connection =
    await this.providerConnectionsRepository.findActiveProviderConnection(
      input.providerConnectionId,
      input.userId,
    );
  if (!connection || connection.provider !== 'vercel') {
    throw new NotFoundException('Vercel provider connection not found');
  }

  return this.encryptionService.decrypt(connection.encryptedToken);
}
```

Then replace the existing provider-connection token block with:

```ts
const vercelToken = await this.resolveVercelToken(input);
```

- [ ] **Step 5: Run the Vercel secret tests**

Run:

```powershell
npm test -- src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts
```

- [ ] **Step 6: Commit**

```powershell
git add src/modules/env-provisioning/vercel-ci-secrets.service.ts src/modules/env-provisioning/vercel-ci-secrets.service.spec.ts
git commit -m "fix: install managed vercel deployment secrets"
```

---

## Task 4: Verify Project Provisioning Summary Includes Managed Vercel Secrets

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts`
- Verify: `cicd-workflow-be/src/modules/env-provisioning/project-deployment-provisioning.service.ts`

- [ ] **Step 1: Add/adjust test for managed Vercel target**

In the test that provisions a managed Vercel target, assert that `vercelCiSecretsService.installForTarget` is called when `deploymentStrategy` is `vercel_ci_pushed`:

```ts
expect(vercelCiSecretsService.installForTarget).toHaveBeenCalledWith(
  expect.objectContaining({
    githubAccessToken: 'github-token',
    repoFullName: 'tone/orders-api',
    providerConnectionId: null,
    target: expect.objectContaining({
      provider: 'vercel',
      ownershipMode: 'flowci_managed',
      deploymentStrategy: 'vercel_ci_pushed',
      providerProjectId: 'prj_managed',
    }),
  }),
);
```

Assert the returned target summary includes:

```ts
expect(result.targets[0]).toMatchObject({
  provider: 'vercel',
  ownershipMode: 'flowci_managed',
  deploymentStrategy: 'vercel_ci_pushed',
  providerMetadata: expect.objectContaining({
    githubSecrets: {
      token: 'VERCEL_FRONTEND_TOKEN',
      orgId: 'VERCEL_FRONTEND_ORG_ID',
      projectId: 'VERCEL_FRONTEND_PROJECT_ID',
    },
  }),
});
```

- [ ] **Step 2: Run the provisioning service test**

Run:

```powershell
npm test -- src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
```

- [ ] **Step 3: Commit**

```powershell
git add src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts src/modules/env-provisioning/project-deployment-provisioning.service.ts
git commit -m "test: verify managed vercel provisioning secrets"
```

---

## Task 5: Verify Generated Workflow Deploys Managed Vercel Through GitHub Actions

**Files:**
- Modify: `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.spec.ts`
- Verify: `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.ts`

- [ ] **Step 1: Add workflow generation test for managed Vercel target**

Add a test that passes this deployment target into the package workflow builder:

```ts
const deploymentTargets = [
  {
    slot: 'frontend',
    provider: 'vercel',
    deploymentStrategy: 'vercel_ci_pushed',
    rootDirectory: 'frontend',
    secretNames: {
      token: 'VERCEL_FRONTEND_TOKEN',
      orgId: 'VERCEL_FRONTEND_ORG_ID',
      projectId: 'VERCEL_FRONTEND_PROJECT_ID',
    },
  },
];
```

Assert the generated YAML contains:

```ts
expect(yaml).toContain('deploy-vercel-frontend:');
expect(yaml).toContain('uses: cicd-external-project/cicd-workflow/.github/workflows/vercel-deploy.yml@v1');
expect(yaml).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_FRONTEND_TOKEN }}');
expect(yaml).toContain('VERCEL_ORG_ID: ${{ secrets.VERCEL_FRONTEND_ORG_ID }}');
expect(yaml).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_FRONTEND_PROJECT_ID }}');
```

- [ ] **Step 2: Run workflow builder tests**

Run:

```powershell
npm test -- src/modules/workflows/staged-workflow.builder.spec.ts --runInBand
```

Expected:

```text
PASS src/modules/workflows/staged-workflow.builder.spec.ts
```

- [ ] **Step 3: Commit**

```powershell
git add src/modules/workflows/staged-workflow.builder.ts src/modules/workflows/staged-workflow.builder.spec.ts
git commit -m "test: verify managed vercel workflow deploy job"
```

---

## Task 6: Update Frontend Copy For Managed Vercel

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/deployment-provisioning-setup.tsx`
- Modify: `cicd-workflow-fe/src/components/product/setup-result-panel.tsx`
- Modify: `cicd-workflow-fe/tests/unit/deployment-provisioning-setup.test.tsx`
- Modify: `cicd-workflow-fe/tests/unit/workflow-builder-setup.test.tsx`

- [ ] **Step 1: Update managed Vercel helper text**

Change `ownershipDescription()` for managed Vercel to:

```ts
return target.ownershipMode === 'byo'
  ? "FlowCI creates a Vercel project in your account and deploys through GitHub Actions. You do not need to install Vercel's GitHub integration."
  : 'FlowCI creates the Vercel project and deploys it through GitHub Actions from the generated workflow.';
```

- [ ] **Step 2: Keep setup-result route label aligned**

In `setup-result-panel.tsx`, ensure:

```ts
case 'vercel_ci_pushed':
  return 'Deploys through GitHub Actions';
```

Do not show `Connected through Vercel Git` for newly provisioned managed Vercel.

- [ ] **Step 3: Add frontend copy test**

In `deployment-provisioning-setup.test.tsx`, assert:

```ts
expect(rendered.container.textContent).toContain(
  'FlowCI creates the Vercel project and deploys it through GitHub Actions from the generated workflow.',
);
```

- [ ] **Step 4: Run targeted frontend tests**

Run:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-fe
npm test -- tests/unit/deployment-provisioning-setup.test.tsx --coverage=false --runInBand
npm test -- tests/unit/workflow-builder-setup.test.tsx --coverage=false --runInBand
```

Expected:

```text
Test Suites: 1 passed
Tests: all passed
```

- [ ] **Step 5: Commit**

```powershell
git add src/components/product/deployment-provisioning-setup.tsx src/components/product/setup-result-panel.tsx tests/unit/deployment-provisioning-setup.test.tsx tests/unit/workflow-builder-setup.test.tsx
git commit -m "fix: clarify managed vercel deployment path"
```

---

## Task 7: Validate Central Reusable Workflow Contract

**Files:**
- Verify: `cicd-workflow/.github/workflows/vercel-deploy.yml`

- [ ] **Step 1: Parse reusable workflow YAML**

Run from backend repo:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
node -e "const fs=require('fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('..\\cicd-workflow\\.github\\workflows\\vercel-deploy.yml','utf8')); console.log('valid')"
```

Expected:

```text
valid
```

- [ ] **Step 2: Confirm reusable workflow accepts required secrets**

Open `C:\Codes\cicd-ex\cicd-workflow\.github\workflows\vercel-deploy.yml` and confirm:

```yaml
secrets:
  VERCEL_TOKEN:
    required: true
  VERCEL_ORG_ID:
    required: true
  VERCEL_PROJECT_ID:
    required: true
```

- [ ] **Step 3: Confirm deploy steps use CLI**

Confirm the workflow includes:

```yaml
- name: Pull Vercel Environment
- name: Build Vercel App
- name: Deploy Prebuilt Vercel App
```

and the deploy step runs:

```bash
vercel deploy --prebuilt --token="${VERCEL_TOKEN}"
```

- [ ] **Step 4: Commit only if workflow changes are required**

If no change is required, do not create a central workflow commit.

If a change is required:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow
git add .github/workflows/vercel-deploy.yml
git commit -m "fix: align vercel reusable deploy contract"
```

---

## Task 8: Full Verification

**Files:**
- Verify all backend/frontend/central workflow changes.

- [ ] **Step 1: Backend verification**

Run:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
npm run typecheck
npm test -- --runInBand
npm run build
```

Expected:

```text
typecheck exits 0
Test Suites: 50 passed, 50 total
Tests: 337 passed, 337 total
build exits 0
```

- [ ] **Step 2: Frontend verification**

Run:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-fe
npm test -- --runInBand
npm run build
```

Expected:

```text
all Jest suites pass
branch coverage remains above configured threshold
Next build exits 0
```

- [ ] **Step 3: Central workflow YAML verification**

Run:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
node -e "const fs=require('fs'); const yaml=require('js-yaml'); for (const f of ['..\\cicd-workflow\\.github\\workflows\\vercel-deploy.yml','..\\cicd-workflow\\.github\\workflows\\render-deploy.yml']) { yaml.load(fs.readFileSync(f,'utf8')); console.log('valid '+f); }"
```

Expected:

```text
valid ..\cicd-workflow\.github\workflows\vercel-deploy.yml
valid ..\cicd-workflow\.github\workflows\render-deploy.yml
```

- [ ] **Step 4: Live verification**

Use deployed test after merge:

1. Log into FlowCI.
2. Create a frontend project using `Managed by FlowCI`.
3. Confirm the setup result says `Deploys through GitHub Actions`.
4. Confirm a Vercel project is created in the configured FlowCI Vercel workspace.
5. Confirm the generated GitHub repo has:

```text
VERCEL_FRONTEND_TOKEN
VERCEL_FRONTEND_ORG_ID
VERCEL_FRONTEND_PROJECT_ID
```

6. Run the package workflow or wait for the chained workflow.
7. Confirm Vercel deployment succeeds.

---

## Task 9: Branch, Push, And Merge Checklist

**Files:**
- Backend branch: `managed-vercel-ci-pushed`
- Frontend branch: `managed-vercel-ci-pushed`
- Central workflow branch only if central workflow changes are required.

- [ ] **Step 1: Create branches from test**

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
git checkout test
git pull origin test
git checkout -b managed-vercel-ci-pushed

cd C:\Codes\cicd-ex\cicd-workflow-fe
git checkout test
git pull origin test
git checkout -b managed-vercel-ci-pushed
```

- [ ] **Step 2: Push branches**

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
git push -u origin managed-vercel-ci-pushed

cd C:\Codes\cicd-ex\cicd-workflow-fe
git push -u origin managed-vercel-ci-pushed
```

- [ ] **Step 3: Open PRs to test**

Create PRs:

```text
cicd-workflow-be: managed-vercel-ci-pushed -> test
cicd-workflow-fe: managed-vercel-ci-pushed -> test
```

- [ ] **Step 4: Merge after checks pass**

After CI passes, merge both PRs into `test`.

- [ ] **Step 5: Confirm deployed env vars**

Backend test deployment must have:

```env
ENV_PROVISIONING_ENABLED=true
ENV_PROVISIONING_ENCRYPTION_KEY=<configured>
FLOWCI_VERCEL_TOKEN=<flowci-managed-vercel-token>
FLOWCI_VERCEL_TEAM_ID=<flowci-managed-vercel-team-id>
FLOWCI_VERCEL_TEAM_SLUG=<optional-flowci-managed-vercel-team-slug>
GITHUB_APP_ID=<configured>
GITHUB_APP_PRIVATE_KEY=<configured>
GITHUB_APP_SLUG=flowci-studio
```

If `FLOWCI_VERCEL_TOKEN` is missing, managed Vercel CI-pushed secret installation must fail with:

```text
FLOWCI_VERCEL_TOKEN is required for FlowCI-managed Vercel deployments
```

---

## Plan Self-Review

**Spec coverage:** Covers the strategy change, Vercel API behavior, managed secret installation, workflow generation, UI copy, verification, and live test.

**Placeholder scan:** No placeholders remain. The plan contains concrete files, code snippets, commands, and expected results.

**Type consistency:** Uses existing names: `vercel_ci_pushed`, `vercel_git_connected`, `provider_native`, `flowci_managed`, `byo`, `VercelCiSecretsService`, `DeploymentStrategyResolver`, `VERCEL_FRONTEND_TOKEN`, `VERCEL_FRONTEND_ORG_ID`, and `VERCEL_FRONTEND_PROJECT_ID`.

**Known implementation note:** The existing UI cleanup changes in `cicd-workflow-fe` should be committed or intentionally carried forward before starting this plan, so branch diffs stay understandable.
