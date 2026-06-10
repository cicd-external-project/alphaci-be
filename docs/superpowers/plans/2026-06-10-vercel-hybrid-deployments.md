# Vercel Hybrid Deployments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FlowCI provisioning support Vercel-first hybrid deployments: FlowCI-managed projects use Vercel's native Git integration when FlowCI owns the workspace, while BYO projects use a CI-pushed Vercel deployment path that does not require the end user to manually install the Vercel GitHub App.

**Architecture:** Add an explicit deployment strategy layer between project provisioning and provider clients. Store the resolved strategy on each deployment target, create Vercel projects differently per strategy, install required GitHub Actions secrets for CI-pushed deployments, and extend generated package-stage workflows to deploy Vercel builds without adding another `workflow_run` hop.

**Tech Stack:** NestJS/TypeScript backend, Supabase Postgres schema `env_provisioning`, GitHub REST Actions Secrets API via existing GitHub service encryption flow, Vercel REST API, generated GitHub Actions YAML, React/Vite frontend.

---

## Source Constraints Reviewed

- Vercel's GitHub Actions guide says GitHub Actions is appropriate when the native Vercel Git integration cannot be used or when full CI/CD control is required. It also documents the required CLI sequence: `vercel pull`, `vercel build`, then `vercel deploy --prebuilt`, with `--prod` for production.
- Vercel's GitHub Actions guide requires these secrets for CLI-based deploys: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
- GitHub repository secrets must be written by fetching the repository public key, encrypting the secret value with that key, then calling the create/update repository secret endpoint.
- Do not add a fourth chained GitHub Actions workflow for Vercel deploy. The existing FlowCI staged chain is `Access Gate -> Quality -> Package`; Vercel deployment must live inside the package workflow as a job or step because GitHub documents limits around nested `workflow_run` chaining.

## Current Baseline

- Backend already has deployment provisioning concepts:
  - `EnvProvider = 'render' | 'vercel'`
  - `EnvOwnershipMode = 'byo' | 'flowci_managed'`
  - `DeploymentTargetSummary`
  - `CreateProviderTargetInput`
  - `DeploymentProvisioningTargetDto`
- Backend currently creates Vercel projects through one provider client path.
- A Vercel GitHub integration failure currently blocks project creation when Vercel rejects `gitRepository`.
- Project workflows are generated as a three-stage bundle and already have backend CI validation.
- Frontend already collects deployment provisioning input and displays target provisioning results.

## Product Decision

Use Hybrid Option C, Vercel-first:

- **Managed default:** FlowCI-owned Vercel workspace, FlowCI-owned GitHub integration, Vercel project connected directly to the repo.
- **BYO advanced:** Customer's Vercel token/workspace, FlowCI creates an unlinked Vercel project, then GitHub Actions pushes deployments through Vercel CLI using repository secrets.
- **UI copy:** Show user-friendly ownership labels:
  - `Managed by FlowCI`
  - `Use my Vercel account`
- **Internal strategy names:** Keep explicit technical names in backend records:
  - `vercel_git_connected`
  - `vercel_ci_pushed`

## Phase 0 - Repo Alignment Fixes Before Implementation

The first draft was directionally correct, but implementation needs to account for these current repo realities:

- `ProjectsService` builds and pushes workflow YAML before `ProjectDeploymentProvisioningService` creates provider targets.
- `staged-workflow.builder.ts` currently uses a hard-coded `CI_VALIDATE_URL` and `secrets.CI_TOKEN`, not `FLOWCI_API_URL` or `FLOWCI_CI_TOKEN`.
- Latest `test` already added `deploymentProvider?: 'vercel' | 'render'` to `GenerateWorkflowDto`, `ProjectsService.extractDeploymentProvider()`, and package-stage reusable deploy jobs.
- Latest `test` currently emits a coarse `deploy-vercel` job whenever the slot provider is Vercel, regardless of ownership mode or deployment strategy.
- Latest `test` emits `uses: cicd-external-project/cicd-workflow/.github/workflows/vercel-deploy.yml@v1`, so this implementation must verify that reusable workflow exists in the centralized workflow repo and move/update `v1` after merging that repo.
- `GithubService.setActionsSecret()` currently logs and returns on failure instead of throwing, which is not strict enough for Vercel CI secret provisioning.
- `provider_connections` has no metadata column today, so BYO Vercel org/team metadata needs a migration too.
- A single repo can have more than one Vercel target, so generic `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` secrets can collide.

Implementation rule:

- Resolve deployment workflow descriptors before workflow generation.
- Replace the current coarse `deploymentProvider` workflow input with strategy-aware deployment descriptors, or keep `deploymentProvider` only as a backward-compatible wrapper around the richer descriptor list.
- Create Vercel provider targets after the project row exists.
- Install GitHub secrets after provider target creation using deterministic per-slot secret names.
- Generate the package workflow using the same deterministic secret names, so workflow generation does not need the provider project id yet.

Add this internal type near the workflow generator boundary:

```ts
export interface DeploymentWorkflowTarget {
  slot: 'backend' | 'frontend' | 'standalone';
  provider: 'vercel';
  deploymentStrategy: 'vercel_ci_pushed';
  rootDirectory: string | null;
  secretNames: {
    token: string;
    orgId: string;
    projectId: string;
  };
}
```

Deterministic secret names:

```ts
function vercelSecretNames(slot: 'backend' | 'frontend' | 'standalone') {
  const prefix = `VERCEL_${slot.toUpperCase()}`;
  return {
    token: `${prefix}_TOKEN`,
    orgId: `${prefix}_ORG_ID`,
    projectId: `${prefix}_PROJECT_ID`,
  };
}
```

Examples:

```text
VERCEL_FRONTEND_TOKEN
VERCEL_FRONTEND_ORG_ID
VERCEL_FRONTEND_PROJECT_ID
VERCEL_STANDALONE_TOKEN
VERCEL_STANDALONE_ORG_ID
VERCEL_STANDALONE_PROJECT_ID
```

## Phase 1 - Data Model And Migration

### 1. Add Deployment Strategy Columns

Create migration:

`supabase/migrations/202606100001_vercel_deployment_strategy.sql`

```sql
BEGIN;

ALTER TABLE env_provisioning.provider_connections
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE env_provisioning.project_deployment_targets
  ADD COLUMN IF NOT EXISTS deployment_strategy TEXT,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE env_provisioning.project_deployment_targets
SET deployment_strategy = CASE
  WHEN provider = 'vercel' AND ownership_mode = 'flowci_managed' THEN 'vercel_git_connected'
  WHEN provider = 'vercel' AND ownership_mode = 'byo' THEN 'vercel_ci_pushed'
  ELSE 'provider_native'
END
WHERE deployment_strategy IS NULL;

ALTER TABLE env_provisioning.project_deployment_targets
  ALTER COLUMN deployment_strategy SET NOT NULL;

ALTER TABLE env_provisioning.project_deployment_targets
  ADD CONSTRAINT project_deployment_targets_strategy_check
  CHECK (deployment_strategy IN ('provider_native', 'vercel_git_connected', 'vercel_ci_pushed'));

CREATE INDEX IF NOT EXISTS idx_project_deployment_targets_strategy
  ON env_provisioning.project_deployment_targets (deployment_strategy);

COMMIT;
```

Create rollback:

`supabase/rollbacks/202606100001_vercel_deployment_strategy_down.sql`

```sql
BEGIN;

DROP INDEX IF EXISTS env_provisioning.idx_project_deployment_targets_strategy;

ALTER TABLE env_provisioning.project_deployment_targets
  DROP CONSTRAINT IF EXISTS project_deployment_targets_strategy_check,
  DROP COLUMN IF EXISTS provider_metadata,
  DROP COLUMN IF EXISTS deployment_strategy;

ALTER TABLE env_provisioning.provider_connections
  DROP COLUMN IF EXISTS metadata;

COMMIT;
```

Why this is safe:

- Existing rows are backfilled before `deployment_strategy` becomes required.
- The rollback only removes new metadata columns and leaves legacy target and provider connection records intact.
- The migration stays inside the existing `env_provisioning` schema boundary.

### 2. Extend Backend Types

Update:

`src/modules/env-provisioning/env-provisioning.types.ts`

Add:

```ts
export type VercelDeploymentStrategy = 'vercel_git_connected' | 'vercel_ci_pushed';
export type DeploymentStrategy = 'provider_native' | VercelDeploymentStrategy;
```

Extend `DeploymentTargetSummary`:

```ts
deploymentStrategy: DeploymentStrategy;
providerMetadata: Record<string, unknown>;
```

Extend provider target types in:

`src/modules/env-provisioning/provider-clients/runtime-env-provider.client.ts`

```ts
export interface CreateProviderTargetInput {
  token: string;
  repoFullName: string;
  projectName: string;
  branchName: string;
  rootDirectory?: string | undefined;
  buildCommand?: string | undefined;
  startCommand?: string | undefined;
  deploymentStrategy?: DeploymentStrategy | undefined;
  vercelTeamId?: string | undefined;
  vercelTeamSlug?: string | undefined;
}

export interface ProviderDeploymentTarget {
  id: string;
  name: string;
  provider: EnvProvider;
  metadata?: Record<string, unknown> | undefined;
}
```

Extend `ProviderConnectionSummary`:

```ts
metadata: Record<string, unknown>;
```

Extend `ProviderConnectionWithToken` through inheritance automatically so BYO provisioning can read saved Vercel org/team metadata when installing deployment secrets.

### 3. Repository Mapping

Update:

`src/modules/env-provisioning/deployment-targets.repository.ts`

Required behavior:

- Insert `deployment_strategy`.
- Insert `provider_metadata`.
- Insert and read `provider_connections.metadata`.
- Map snake case DB columns back to camel case response fields.
- Default old records defensively in mapper:

```ts
deploymentStrategy: row.deployment_strategy ?? 'provider_native',
providerMetadata: row.provider_metadata ?? {},
```

## Phase 2 - Strategy Resolution

### 1. Add Resolver

Create:

`src/modules/env-provisioning/deployment-strategy.resolver.ts`

```ts
import { Injectable } from '@nestjs/common';
import {
  DeploymentStrategy,
  EnvOwnershipMode,
  EnvProvider,
} from './env-provisioning.types';

export interface ResolveDeploymentStrategyInput {
  provider: EnvProvider;
  ownershipMode: EnvOwnershipMode;
}

@Injectable()
export class DeploymentStrategyResolver {
  resolve(input: ResolveDeploymentStrategyInput): DeploymentStrategy {
    if (input.provider === 'vercel' && input.ownershipMode === 'flowci_managed') {
      return 'vercel_git_connected';
    }

    if (input.provider === 'vercel' && input.ownershipMode === 'byo') {
      return 'vercel_ci_pushed';
    }

    return 'provider_native';
  }
}
```

Register the resolver in:

`src/modules/env-provisioning/env-provisioning.module.ts`

### 2. Add Resolver Tests

Create:

`src/modules/env-provisioning/deployment-strategy.resolver.spec.ts`

Cases:

- Vercel + FlowCI-managed returns `vercel_git_connected`.
- Vercel + BYO returns `vercel_ci_pushed`.
- Render + any ownership mode returns `provider_native`.

Expected command:

```powershell
npm test -- src/modules/env-provisioning/deployment-strategy.resolver.spec.ts
```

Expected result:

```text
PASS src/modules/env-provisioning/deployment-strategy.resolver.spec.ts
```

## Phase 3 - Vercel Provider Behavior

### 1. Split Vercel Project Creation By Strategy

Update:

`src/modules/env-provisioning/provider-clients/vercel-env.client.ts`

Behavior:

- For `vercel_git_connected`:
  - Include `gitRepository`.
  - Use FlowCI-managed token from `FLOWCI_VERCEL_TOKEN`.
  - Use `FLOWCI_VERCEL_TEAM_ID` or `FLOWCI_VERCEL_TEAM_SLUG` when configured.
  - If Vercel returns missing GitHub integration, return a clear admin setup error.
- For `vercel_ci_pushed`:
  - Do not include `gitRepository`.
  - Create an unlinked project.
  - Still apply normalized `rootDirectory`, `buildCommand`, and framework settings when supported.
  - Return project id and organization id metadata needed by GitHub Actions.

Payload rule:

```ts
const shouldConnectGit = input.deploymentStrategy === 'vercel_git_connected';

const payload = {
  name: input.projectName,
  ...(input.rootDirectory ? { rootDirectory: input.rootDirectory } : {}),
  ...(input.buildCommand ? { buildCommand: input.buildCommand } : {}),
  ...(shouldConnectGit
    ? {
        gitRepository: {
          type: 'github',
          repo: input.repoFullName,
        },
      }
    : {}),
};
```

Vercel team routing:

```ts
private withTargetScope(url: string, input: CreateProviderTargetInput): string {
  const scopedUrl = new URL(url);

  if (input.vercelTeamId) {
    scopedUrl.searchParams.set('teamId', input.vercelTeamId);
  } else if (input.vercelTeamSlug) {
    scopedUrl.searchParams.set('slug', input.vercelTeamSlug);
  }

  return scopedUrl.toString();
}
```

Do not reuse the current config-only `withScope()` for BYO Vercel target creation because it always reads FlowCI-managed team env vars. Keep config-based scoping for FlowCI-managed calls, and pass explicit team metadata for BYO calls.

Metadata returned:

```ts
metadata: {
  deploymentStrategy: input.deploymentStrategy,
  vercelProjectId: response.id,
  vercelOrgId: resolvedOrgId,
  vercelTeamId: input.vercelTeamId,
  vercelTeamSlug: input.vercelTeamSlug,
  gitConnected: shouldConnectGit,
}
```

### 2. Resolve Vercel Org Id

Add helper in `vercel-env.client.ts`:

```ts
private async resolveVercelOrgId(token: string, input: CreateProviderTargetInput): Promise<string> {
  if (input.vercelTeamId) {
    return input.vercelTeamId;
  }

  const user = await this.fetchCurrentUser(token);
  return user.uid;
}
```

Implementation note:

- If the token belongs to a personal account, `VERCEL_ORG_ID` is the user id.
- If the token targets a team, the team id must come from `FLOWCI_VERCEL_TEAM_ID` for managed mode or the provider connection metadata for BYO mode.

### 3. Provider Client Tests

Update or add:

`src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts`

Cases:

- `vercel_git_connected` includes `gitRepository`.
- `vercel_ci_pushed` omits `gitRepository`.
- Root directory is sent without `./`.
- Team id is sent through query params when provided.
- Missing GitHub integration error maps to a user-readable FlowCI-managed setup error.

## Phase 4 - Provider Connection Metadata

### 1. Extend BYO Vercel Connection Shape

Update provider connection DTOs and repository mapping so a BYO Vercel connection can store:

```ts
interface VercelProviderConnectionMetadata {
  accountType: 'user' | 'team';
  orgId: string;
  teamId?: string;
  teamSlug?: string;
}
```

Files to inspect and update:

- `src/modules/env-provisioning/dto/create-provider-connection.dto.ts`
- `src/modules/env-provisioning/provider-connections.repository.ts`
- `src/modules/env-provisioning/provider-connections.service.ts`

Repository changes:

- Add `metadata?: Record<string, unknown>` to `CreateProviderConnectionInput`.
- Insert `metadata` into `env_provisioning.provider_connections`.
- Select `metadata` in list and find queries.
- Default old rows to `{}` in `toSummary()`.

### 2. Validate Connection With Org Metadata

For BYO Vercel:

- Validate token with Vercel user endpoint.
- If user supplied a team id or slug, validate that token can access the team before saving.
- Store encrypted token as already implemented.
- Store metadata with the resolved `orgId`.
- Keep Render connections compatible by storing `{}` metadata for Render.

Expected API behavior:

- Personal token:

```json
{
  "provider": "vercel",
  "ownershipMode": "byo",
  "metadata": {
    "accountType": "user",
    "orgId": "user_123"
  }
}
```

- Team token:

```json
{
  "provider": "vercel",
  "ownershipMode": "byo",
  "metadata": {
    "accountType": "team",
    "orgId": "team_123",
    "teamId": "team_123",
    "teamSlug": "customer-team"
  }
}
```

## Phase 5 - GitHub Actions Secret Provisioning

### 1. Reuse Existing GitHub Secret Writer

Inspect:

`src/modules/github/github.service.ts`

Expected existing method:

```ts
setActionsSecret(
  accessToken: string,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string,
): Promise<void>
```

This method already exists, but it currently logs and returns when GitHub rejects the operation. For Vercel CI provisioning, add a strict wrapper or add an option so failures throw:

```ts
async setActionsSecretStrict(
  accessToken: string,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  await this.setActionsSecret(accessToken, owner, repo, secretName, secretValue, {
    throwOnFailure: true,
  });
}
```

If the existing method is refactored, preserve current non-fatal behavior for `CI_TOKEN` and branch protection call sites unless those call sites are intentionally hardened in the same task.

The strict path must use the GitHub REST flow:

- `GET /repos/{owner}/{repo}/actions/secrets/public-key`
- Encrypt secret value with the returned public key.
- `PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}`

### 2. Add Vercel CI Secret Installer

Create:

`src/modules/env-provisioning/vercel-ci-secrets.service.ts`

```ts
export interface InstallVercelCiSecretsInput {
  githubAccessToken: string;
  repoFullName: string;
  slot: 'backend' | 'frontend' | 'standalone';
  vercelToken: string;
  vercelOrgId: string;
  vercelProjectId: string;
}
```

Secrets installed:

```text
VERCEL_<SLOT>_TOKEN
VERCEL_<SLOT>_ORG_ID
VERCEL_<SLOT>_PROJECT_ID
```

For a frontend target:

```text
VERCEL_FRONTEND_TOKEN
VERCEL_FRONTEND_ORG_ID
VERCEL_FRONTEND_PROJECT_ID
```

For a standalone target:

```text
VERCEL_STANDALONE_TOKEN
VERCEL_STANDALONE_ORG_ID
VERCEL_STANDALONE_PROJECT_ID
```

Implementation rule:

- Only install these secrets for `deploymentStrategy === 'vercel_ci_pushed'`.
- Never install FlowCI's managed Vercel token into a customer-owned repository.
- If the GitHub secret install fails after the Vercel project was created, mark target status as `failed` with a precise error and expose a retry action later.
- Store the installed secret names in `provider_metadata.githubSecrets` on the deployment target.
- Do not use unscoped `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` because those names collide when one repository has more than one Vercel deployment target.

### 3. Pass GitHub Access Token Into Provisioning

Update:

`src/modules/env-provisioning/project-deployment-provisioning.service.ts`

Current provisioning input should be extended to include:

```ts
githubAccessToken: string;
```

Update caller:

`src/modules/projects/projects.service.ts`

Rule:

- The same GitHub token used to create or access the repository should be passed into deployment provisioning.
- Do not fetch a separate GitHub token in the env provisioning module unless the existing project setup path cannot supply one.
- Update every project creation path, not only standalone:
  - `createProject()`
  - `createMicroservicesProject()`
  - `createMultiRepoProject()`
  - `setupProject()`

## Phase 6 - Workflow Generation

### 1. Keep Three Workflow Files

Do not generate a fourth Vercel deploy workflow.

Keep:

```text
.github/workflows/00-flowci-access.yml
.github/workflows/10-flowci-quality.yml
.github/workflows/20-flowci-package.yml
```

### 2. Add Conditional Vercel Deploy Job To Package Stage

Update the workflow generator used for `20-flowci-package.yml`.

Files:

- `src/modules/workflows/staged-workflow.builder.ts`
- `src/modules/projects/projects.service.ts`
- `src/modules/workflows/dto/generate-workflow.dto.ts`

Generated package workflow should include one Vercel deploy job for each target descriptor with `deploymentStrategy === 'vercel_ci_pushed'`. The latest `test` branch already added a coarse provider-level job:

```ts
...(deploymentProvider === 'vercel' && {
  'deploy-vercel': vercelDeployJob(serviceName, servicePath),
}),
```

Replace that with strategy-aware descriptor expansion so managed Vercel does not run the CI-pushed deploy path.

Extend `buildStagedWorkflowBundle()`:

```ts
export function buildStagedWorkflowBundle(
  template: WorkflowTemplate,
  dto: GenerateWorkflowDto,
  deploymentTargets: DeploymentWorkflowTarget[] = [],
): StagedWorkflowBundle {
  // existing implementation
}
```

Before calling `buildWorkflowBundle()` in `ProjectsService`, derive descriptors from `dto.deploymentProvisioning`:

```ts
const deploymentWorkflowTargets =
  this.resolveDeploymentWorkflowTargets(dto.deploymentProvisioning, ['frontend', 'standalone']);
```

For microservices and multi-repo, filter by the slot being generated so the backend workflow does not receive frontend deploy jobs and the frontend workflow does not receive backend deploy jobs.

Required caller job shape:

```yaml
deploy-vercel-frontend:
  name: Deploy frontend to Vercel
  needs:
    - build
  uses: cicd-external-project/cicd-workflow/.github/workflows/vercel-deploy.yml@v1
  if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
  with:
    system-name: frontend
    working-directory: frontend
    checkout-ref: ${{ github.event.workflow_run.head_sha || github.sha }}
    environment: ${{ github.event.workflow_run.head_branch == 'main' && 'production' || 'preview' }}
  secrets:
    VERCEL_TOKEN: ${{ secrets.VERCEL_FRONTEND_TOKEN }}
    VERCEL_ORG_ID: ${{ secrets.VERCEL_FRONTEND_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_FRONTEND_PROJECT_ID }}
```

The reusable workflow must implement the Vercel CLI sequence:

```yaml
- vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
- vercel build --token="$VERCEL_TOKEN"
- vercel deploy --prebuilt --token="$VERCEL_TOKEN"
- Use `--prod` for production.
```

Use `working-directory` from the target `rootDirectory`. If root directory is empty, omit `working-directory`.

Use `CI_VALIDATE_URL` from the existing workflow-level env in `staged-workflow.builder.ts`. Do not introduce `FLOWCI_API_URL` unless the whole validator URL configuration is refactored in the same implementation.

### 3. Central Workflow Repo Dependency

Update `C:\Codes\cicd-ex\cicd-workflow` after the backend/FE plan branch is ready:

- Ensure the repo remote points to `https://github.com/cicd-external-project/cicd-workflow.git` or push through the correct GitHub remote.
- Add `.github/workflows/vercel-deploy.yml` if it is not already on `origin/test`.
- Add or verify `.github/workflows/render-deploy.yml` because latest backend `test` already references it.
- Both reusable workflows must use `workflow_call`.
- `vercel-deploy.yml` must accept inputs:
  - `system-name`
  - `working-directory`
  - `checkout-ref`
  - `environment`
- `vercel-deploy.yml` must require secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- After merging central workflow changes to `test`, move/update the `v1` tag so generated workflows using `@v1` can resolve the new reusable workflow.

### 4. Workflow Tests

Update:

- `src/modules/workflows/*.spec.ts`
- Any existing YAML validation tests using `js-yaml`

Cases:

- Vercel BYO target adds Vercel deploy job inside `20-flowci-package.yml`.
- Vercel managed target does not add the CI-pushed reusable Vercel deploy caller.
- Multiple Vercel BYO targets generate separate job ids and separate per-slot secret names.
- No fourth workflow file is generated.
- Package workflow still validates backend CI access.
- Vercel deploy checkout uses `github.event.workflow_run.head_sha`.
- Generated YAML parses successfully.

## Phase 7 - API Contracts

### 1. Project Creation Response

Update project setup response contract so deployment targets include:

```json
{
  "provider": "vercel",
  "slot": "frontend",
  "ownershipMode": "byo",
  "deploymentStrategy": "vercel_ci_pushed",
  "status": "active",
  "providerMetadata": {
    "gitConnected": false,
    "githubSecrets": {
      "token": "VERCEL_FRONTEND_TOKEN",
      "orgId": "VERCEL_FRONTEND_ORG_ID",
      "projectId": "VERCEL_FRONTEND_PROJECT_ID"
    }
  }
}
```

Keep existing fields for compatibility:

- `workflowPath`
- `workflowFiles`
- Existing deployment target ids and names

Extend `DeploymentProvisioningResult.targets[]` in `src/modules/projects/projects.service.ts`:

```ts
ownershipMode: 'byo' | 'flowci_managed';
deploymentStrategy: 'provider_native' | 'vercel_git_connected' | 'vercel_ci_pushed';
providerMetadata: Record<string, unknown>;
```

Frontend should treat those fields as optional when rendering older API responses.

### 2. Error Shape

Use stable codes in backend exceptions:

```ts
type DeploymentProvisioningErrorCode =
  | 'VERCEL_GITHUB_INTEGRATION_REQUIRED'
  | 'VERCEL_PROJECT_CREATE_FAILED'
  | 'VERCEL_CI_SECRET_INSTALL_FAILED'
  | 'VERCEL_ORG_METADATA_MISSING';
```

User-facing messages:

- Managed Git integration failure:
  - `FlowCI's Vercel workspace is not connected to this GitHub organization yet. Connect the Vercel GitHub integration for the FlowCI workspace, then retry provisioning.`
- BYO CI secret failure:
  - `Vercel project was created, but FlowCI could not install the Vercel deployment secrets in GitHub. Check repository Actions secret permissions and retry.`

## Phase 8 - Frontend UX

### 1. Update Ownership Selection Copy

Frontend files to inspect:

- `cicd-workflow-fe/src/components/product/deployment-provisioning-setup.tsx`
- `cicd-workflow-fe/src/components/product/setup-result-panel.tsx`
- `cicd-workflow-fe/src/lib/api/contracts.ts`

UI labels:

```text
Managed by FlowCI
Use my Vercel account
```

Descriptions:

- Managed by FlowCI:
  - `FlowCI creates and connects the Vercel project from its managed workspace. Best for teams that want the least setup.`
- Use my Vercel account:
  - `FlowCI creates a Vercel project in your account and deploys through GitHub Actions. You do not need to install Vercel's GitHub integration.`

### 2. Show Strategy Outcome, Not Raw Strategy Names

Display:

- `Connected through Vercel Git` for `vercel_git_connected`.
- `Deploys through GitHub Actions` for `vercel_ci_pushed`.
- `Provider native` for other providers.

Do not show raw values like `vercel_ci_pushed` in normal product UI.

### 3. Add Missing Setup Guidance

When BYO Vercel is selected:

- Require a connected Vercel provider connection.
- If the selected connection targets a team, show the team name or slug.
- Show a short note that FlowCI will install `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` into the GitHub repo.
- Show the actual per-slot secret names when available:
  - `VERCEL_FRONTEND_TOKEN`
  - `VERCEL_FRONTEND_ORG_ID`
  - `VERCEL_FRONTEND_PROJECT_ID`

When managed Vercel is selected:

- Do not ask the user for Vercel credentials.
- If backend returns `VERCEL_GITHUB_INTEGRATION_REQUIRED`, show it as a FlowCI setup issue rather than implying the customer needs to install something.

### 4. Frontend Tests

Add or update tests:

- Multiple deployment target result rendering.
- BYO Vercel explains GitHub Actions deploy.
- Managed Vercel explains native Git deploy.
- Per-slot GitHub secret names render when backend returns them.
- Legacy project records without `deploymentStrategy` still render.

Expected command:

```powershell
npm test -- --run
```

Expected result:

```text
Test Files  ... passed
Tests       ... passed
```

## Phase 9 - Environment Variables

Backend deployment variables:

```env
ENV_PROVISIONING_ENABLED=true
ENV_PROVISIONING_ENCRYPTION_KEY=<32-byte-base64-or-hex-key>

FLOWCI_RENDER_API_KEY=<render-api-key>
FLOWCI_RENDER_OWNER_ID=<render-owner-id>

FLOWCI_VERCEL_TOKEN=<flowci-managed-vercel-token>
FLOWCI_VERCEL_TEAM_ID=<flowci-managed-vercel-team-id>
FLOWCI_VERCEL_TEAM_SLUG=<flowci-managed-vercel-team-slug>

GITHUB_APP_ID=<github-app-id>
GITHUB_APP_PRIVATE_KEY=<github-app-private-key>
GITHUB_APP_SLUG=flowci-studio
GITHUB_APP_WEBHOOK_SECRET=<github-webhook-secret>
GITHUB_CLIENT_ID=<github-oauth-client-id>
GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
GITHUB_SCOPE=repo,user:email,read:org

SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_DB_URL=<supabase-db-url>

FRONTEND_URL=<frontend-url>
ALLOWED_ORIGINS=<comma-separated-frontend-origins>
ALLOWED_ORIGIN_PATTERNS=<optional-regex-patterns>

PAYMENT_PROVIDER=<none-or-paymongo>
SUBSCRIPTION_MOCK_ENABLED=<true-for-test-only>
```

Frontend deployment variables:

```env
VITE_API_BASE_URL=<backend-url>
VITE_ENV_PROVISIONING_ENABLED=true
```

Notes:

- `FLOWCI_VERCEL_TOKEN` and `FLOWCI_VERCEL_TEAM_ID` are only for FlowCI-managed Vercel.
- BYO Vercel tokens are user/provider connection data and must not be configured as global backend env vars.
- `FLOWCI_VERCEL_TEAM_ID` is preferred over slug because it is stable.
- `VERCEL_FRONTEND_TOKEN`, `VERCEL_FRONTEND_ORG_ID`, and `VERCEL_FRONTEND_PROJECT_ID` are not backend env vars. FlowCI writes them into the user's GitHub repository Actions secrets for CI-pushed deployments.

## Phase 10 - Rollout And Verification

### 1. Local Unit Verification

Backend:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
npm test -- src/modules/env-provisioning/deployment-strategy.resolver.spec.ts
npm test -- src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts
npm test -- src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
npm test -- src/modules/workflows
npm run build
```

Frontend:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-fe
npm test -- --run
npm run build
```

### 2. Migration Verification

Dry-run against a local or staging Supabase database first:

```powershell
cd C:\Codes\cicd-ex\cicd-workflow-be
supabase db push --dry-run
```

Apply to staging/test:

```powershell
supabase db push
```

Verify:

```sql
SELECT provider, ownership_mode, deployment_strategy, COUNT(*)
FROM env_provisioning.project_deployment_targets
GROUP BY provider, ownership_mode, deployment_strategy
ORDER BY provider, ownership_mode, deployment_strategy;
```

Expected migrated values:

```text
vercel | flowci_managed | vercel_git_connected
vercel | byo            | vercel_ci_pushed
render | flowci_managed | provider_native
render | byo            | provider_native
```

### 3. Manual End-To-End Checks

Managed Vercel:

- Create project with frontend Vercel target and `Managed by FlowCI`.
- Backend creates a Vercel project connected to GitHub.
- Generated workflow bundle still has exactly three files.
- Vercel native deployment starts from Vercel Git integration.

BYO Vercel:

- Create or select BYO Vercel provider connection.
- Create project with frontend Vercel target and `Use my Vercel account`.
- Backend creates an unlinked Vercel project.
- Backend installs GitHub repository secrets:
  - `VERCEL_FRONTEND_TOKEN`
  - `VERCEL_FRONTEND_ORG_ID`
  - `VERCEL_FRONTEND_PROJECT_ID`
- Generated package workflow includes the reusable Vercel deploy caller job.
- Push to repo triggers Access Gate, Quality, Package, then package-stage Vercel deploy job.

Failure checks:

- Remove GitHub Actions secret write permission and confirm target status becomes failed with `VERCEL_CI_SECRET_INSTALL_FAILED`.
- Use FlowCI-managed Vercel without GitHub integration and confirm error code `VERCEL_GITHUB_INTEGRATION_REQUIRED`.
- Use invalid BYO Vercel token and confirm provider connection validation fails before project creation.

## Phase 11 - Implementation Order

- [ ] Create migration and rollback.
- [ ] Extend deployment target types and repository mapping.
- [ ] Add `DeploymentStrategyResolver` and unit tests.
- [ ] Update Vercel provider client to support `vercel_git_connected` and `vercel_ci_pushed`.
- [ ] Extend BYO Vercel provider connection metadata for org/team id.
- [ ] Add strict GitHub Actions secret writing for Vercel CI secrets.
- [ ] Add Vercel CI secret installation service using per-slot GitHub repository secrets.
- [ ] Pass GitHub access token into deployment provisioning.
- [ ] Store deployment strategy and provider metadata on target creation.
- [ ] Derive deployment workflow target descriptors before workflow YAML generation.
- [ ] Extend package workflow generation with conditional reusable Vercel deploy caller jobs.
- [ ] Add or verify centralized `vercel-deploy.yml` and `render-deploy.yml` reusable workflows in `cicd-workflow`, then move/update `v1`.
- [ ] Update backend tests and YAML validation tests.
- [ ] Update frontend API contract types.
- [ ] Update frontend ownership UI and result panel copy.
- [ ] Update frontend tests.
- [ ] Run backend and frontend builds.
- [ ] Apply migration to staging/test.
- [ ] Run manual managed Vercel and BYO Vercel project creation checks.

## Phase 12 - Risk Register

### Risk: BYO Vercel Token In Customer GitHub Secrets

Impact:

- A customer's Vercel token is installed into their repository secrets.

Mitigation:

- Only install BYO token into the same customer repository being provisioned.
- Document this in the UI before provisioning.
- Use Vercel project-scoped or limited tokens when Vercel supports the required API actions.

### Risk: Vercel Team Id Ambiguity

Impact:

- Project can be created in the wrong Vercel workspace if only a token is supplied and the account has multiple teams.

Mitigation:

- Require explicit team id or team slug for team-based BYO Vercel connections.
- Prefer `FLOWCI_VERCEL_TEAM_ID` for managed mode.
- Store resolved org metadata on the provider connection and on the deployment target.

### Risk: Partial Provisioning

Impact:

- Vercel project can be created but GitHub secret installation can fail.

Mitigation:

- Store target as `failed`.
- Preserve provider project id in `provider_metadata`.
- Add retry support after the MVP if manual re-run is needed.

### Risk: Workflow Chain Limit

Impact:

- Adding a separate deploy workflow could silently fail or become unreliable.

Mitigation:

- Keep exactly three generated workflow files.
- Add Vercel deploy as a job inside `20-flowci-package.yml`.

### Risk: Managed Vercel GitHub Integration Setup

Impact:

- Managed Vercel cannot connect repos unless FlowCI's Vercel workspace has the Vercel GitHub integration installed for the target org/repo access.

Mitigation:

- Treat this as FlowCI admin setup, not customer setup.
- Return `VERCEL_GITHUB_INTEGRATION_REQUIRED` with clear operations guidance.

## Acceptance Criteria

- Vercel managed target creates a Git-connected Vercel project using FlowCI-managed credentials.
- Vercel BYO target creates an unlinked Vercel project and deploys through GitHub Actions.
- BYO Vercel does not require the user to install Vercel's GitHub integration.
- GitHub repo gets per-slot Vercel secrets such as `VERCEL_FRONTEND_TOKEN`, `VERCEL_FRONTEND_ORG_ID`, and `VERCEL_FRONTEND_PROJECT_ID` for CI-pushed Vercel targets.
- Generated workflow bundle remains exactly three files.
- Package workflow checks out `github.event.workflow_run.head_sha`.
- Package workflow validates FlowCI backend access before Vercel deploy.
- Package workflow continues using the existing `CI_VALIDATE_URL` and `secrets.CI_TOKEN` contract unless that contract is deliberately refactored.
- Frontend shows readable ownership and deployment route labels.
- Existing Render provisioning remains unchanged.
- Existing legacy project records still render without frontend errors.
- Migration can be rolled back by running the matching rollback SQL.

## Self-Review

- Spec coverage: The plan covers Vercel project creation, managed versus BYO ownership, GitHub secret provisioning, generated workflow changes, frontend UX, migrations, environment variables, rollout checks, and rollback.
- Soundness check: The plan avoids adding a fourth `workflow_run` workflow and uses Vercel's documented GitHub Actions deploy sequence.
- Schema boundary check: New database fields stay in the `env_provisioning` schema and do not alter unrelated service schemas.
- Security check: FlowCI-managed Vercel token is not installed into customer repositories. BYO token is only installed for BYO Vercel CI deployments.
- Placeholder scan: This plan contains concrete filenames, migration SQL, type additions, workflow snippets, verification commands, and expected outcomes.
