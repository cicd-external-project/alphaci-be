# Render Deployment Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full Render deployment provisioning parity with the current Vercel CI-pushed flow, covering FlowCI-managed Render, BYO Render, existing Render services, monorepos, service types, cost controls, optimized Docker generation, GHCR image deployment, and Render API deploy automation.

**Architecture:** Render provisioning becomes strategy-based. Managed Render defaults to `render_image_pushed`: FlowCI creates image-backed Render services, installs per-slot GitHub Actions secrets, generated workflows build/push Docker images to GHCR, and deploy Render through the Render deploy API. BYO Render supports `render_image_pushed`, `render_git_connected`, and existing service attachment, while the UI keeps Docker details hidden behind advanced controls.

**Tech Stack:** NestJS, PostgreSQL/Supabase migrations, Render REST API, GitHub Actions reusable workflows, GHCR, Docker Buildx, TypeScript, Next.js/React, Jest, js-yaml.

---

## Sources And Current Constraints

- Render deploys can be triggered through `POST /v1/services/{serviceId}/deploys` with an image URL, and image-backed services can pull prebuilt images: <https://api-docs.render.com/reference/create-deploy>
- Render supports prebuilt Docker images from GitHub Container Registry and private registries with credentials: <https://render.com/docs/deploying-an-image>
- Render `POST /v1/services` creates services in a workspace and accepts `ownerId`, `repo`, `branch`, and `image`: <https://api-docs.render.com/reference/create-service>
- Current backend docs say Render still uses `provider_native`, while Vercel uses `vercel_ci_pushed`: `cicd-workflow-be/docs/deployment-provisioning.md`
- Current central Render reusable workflow only triggers Render through existing API/service secrets; it does not build/push images: `cicd-workflow/.github/workflows/render-deploy.yml`
- Current generated package workflow already grants `packages: write`: `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.ts`

---

## Product Decisions Locked By This Plan

### Ownership Modes

| Ownership | Default Render strategy | User-facing UX |
| --- | --- | --- |
| FlowCI-managed | `render_image_pushed` | User sees Render service name, environment, plan, env vars. Docker is hidden. |
| BYO Render | `render_git_connected` for native build, `render_image_pushed` when selected | User connects Render API key and chooses native Git build or image deploy. |
| Existing service | `render_existing_service` | User selects or enters an existing Render service. FlowCI provisions env vars and Render API deployment secrets. |

### Render Service Types

The schema and UI must support these Render service types:

- `web_service`
- `private_service`
- `background_worker`
- `cron_job`

The default is `web_service`. If the selected service type cannot use the configured free instance type, backend validation must reject it unless managed paid provisioning is explicitly enabled.

### Cost Controls

Managed Render must never create unbounded paid infrastructure.

Default policy:

- Managed default instance type: `free`
- Managed paid provisioning: disabled unless `FLOWCI_RENDER_ALLOW_PAID_MANAGED=true`
- Managed service quota per user: enforced by backend config
- Paid or unsupported free combinations: rejected with a clean message
- BYO mode: user may choose supported instance types for their workspace, with UI cost warnings

### Monorepos

Monorepo support is first-class. Deployment target metadata must separately track:

- `rootDirectory`
- `dockerContext`
- `dockerfilePath`
- `serviceType`
- `deploymentStrategy`
- `branchName`
- `environmentName`

Default monorepo mapping:

```text
frontend:
  provider: vercel
  rootDirectory: frontend
  deploymentStrategy: vercel_ci_pushed

backend:
  provider: render
  rootDirectory: backend
  dockerContext: backend
  dockerfilePath: backend/Dockerfile
  deploymentStrategy: render_image_pushed
```

### First Image Bootstrap

Render image-backed service creation needs an image URL before the customer app image exists. This plan solves that by using a FlowCI-owned bootstrap image:

```env
FLOWCI_RENDER_BOOTSTRAP_IMAGE=docker.io/library/nginx:alpine
```

FlowCI creates the Render service with the bootstrap image, installs the Render API deployment secrets, then the first package workflow builds the real application image and deploys it through `POST /v1/services/{serviceId}/deploys` with `imageUrl`.

---

## File Structure

### Backend: `cicd-workflow-be`

- Modify: `src/modules/env-provisioning/env-provisioning.types.ts`
  - Add Render strategy, service type, deploy method, instance type, Docker metadata types.
- Modify: `src/modules/projects/dto/create-project.dto.ts`
  - Add Render provisioning request fields used during project creation/setup.
- Modify: `src/modules/env-provisioning/dto/create-deployment-target.dto.ts`
  - Add the same Render target fields for direct deployment target creation.
- Modify: `src/lib/api/contracts.ts` in frontend to match backend contract.
- Create: `supabase/migrations/20260611_render_deployment_provisioning.sql`
  - Add nullable Render-specific columns with check constraints and backfill.
- Modify: `src/config/app.config.ts`
  - Add managed Render cost, region, bootstrap image, and registry settings.
- Modify: `src/common/config/env.validation.ts`
  - Validate new environment variables.
- Modify: `src/modules/env-provisioning/deployment-strategy.resolver.ts`
  - Resolve Render strategies explicitly.
- Create: `src/modules/env-provisioning/render-cost-policy.service.ts`
  - Enforce managed service quotas and allowed instance types.
- Modify: `src/modules/env-provisioning/provider-clients/render-env.client.ts`
  - Create Git-backed and image-backed Render services.
  - Store Render API deploy metadata.
  - Normalize Render errors.
- Create: `src/modules/env-provisioning/render-ci-secrets.service.ts`
  - Install per-slot Render deploy secrets into GitHub Actions.
- Modify: `src/modules/env-provisioning/project-deployment-provisioning.service.ts`
  - Install Render deploy secrets after creating image-backed or existing Render targets.
- Modify: `src/modules/env-provisioning/deployment-targets.repository.ts`
  - Persist Render-specific columns.
- Modify: `src/modules/projects/scaffold.builder.ts`
  - Generate optimized Dockerfile and `.dockerignore` for backend Render targets.
- Modify: `src/modules/workflows/staged-workflow.builder.ts`
  - Emit per-target Render image deployment jobs, not a single provider-level Render job.
- Modify: `docs/deployment-provisioning.md`
  - Replace old Render native-only behavior with the new strategy model.

### Central Workflow: `cicd-workflow`

- Modify: `.github/workflows/render-deploy.yml`
  - Accept Docker context, Dockerfile path, image name, tag, and Render API deployment secrets.
  - Build/push to GHCR.
  - Trigger the Render deploy API with `imageUrl`.
- Create: `docs/workflows/render-deploy.md`
  - Document reusable workflow inputs, secrets, and behavior.

### Frontend: `cicd-workflow-fe`

- Modify: `src/lib/api/contracts.ts`
  - Mirror backend Render request/result contract.
- Modify: `src/components/product/deployment-provisioning-setup.tsx`
  - Add Render managed/BYO strategy UX, service type, instance type, region, Docker advanced fields, existing service attach.
- Modify: `src/components/product/setup-result-panel.tsx`
  - Show Render image deploy status, service type, instance type, Render API deployment secrets installation, and clean warnings.
- Modify: `src/components/product/workflow-builder-utils.ts`
  - Clean Render error messages.
- Add/modify tests under `tests/unit/*render*`, `deployment-provisioning-setup.test.tsx`, `workflow-builder-utils.test.ts`.

---

## Task 1: Extend Shared Types And API Contracts

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-provisioning.types.ts`
- Modify: `cicd-workflow-be/src/modules/projects/dto/create-project.dto.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/dto/create-deployment-target.dto.ts`
- Modify: `cicd-workflow-fe/src/lib/api/contracts.ts`
- Test: `cicd-workflow-be/src/modules/projects/projects.service.spec.ts`
- Test: `cicd-workflow-fe/tests/unit/env-provisioning-api.test.ts`

- [ ] **Step 1: Update backend deployment strategy types**

In `env-provisioning.types.ts`, replace the deployment strategy type block with:

```ts
export type RenderDeploymentStrategy =
  | 'render_git_connected'
  | 'render_image_pushed'
  | 'render_existing_service';

export type VercelDeploymentStrategy =
  | 'vercel_git_connected'
  | 'vercel_ci_pushed';

export type DeploymentStrategy =
  | 'provider_native'
  | VercelDeploymentStrategy
  | RenderDeploymentStrategy;

export type RenderServiceType =
  | 'web_service'
  | 'private_service'
  | 'background_worker'
  | 'cron_job';

export type RenderDeployMethod =
  | 'managed_image'
  | 'byo_image'
  | 'native_git'
  | 'existing_service';

export type RenderEnvironmentName = 'test' | 'uat' | 'production';
```

Extend `DeploymentTargetSummary` with:

```ts
  renderServiceType: RenderServiceType | null;
  renderInstanceType: string | null;
  renderRegion: string | null;
  renderEnvironmentName: RenderEnvironmentName | null;
  dockerContext: string | null;
  dockerfilePath: string | null;
  imageUrl: string | null;
```

- [ ] **Step 2: Update backend project provisioning DTO**

In `create-project.dto.ts`, add these fields to `DeploymentProvisioningTargetDto`:

```ts
  @IsOptional()
  @IsIn(['managed_image', 'byo_image', 'native_git', 'existing_service'])
  renderDeployMethod?: 'managed_image' | 'byo_image' | 'native_git' | 'existing_service';

  @IsOptional()
  @IsIn(['web_service', 'private_service', 'background_worker', 'cron_job'])
  renderServiceType?: 'web_service' | 'private_service' | 'background_worker' | 'cron_job';

  @IsOptional()
  @IsString()
  renderInstanceType?: string;

  @IsOptional()
  @IsString()
  renderRegion?: string;

  @IsOptional()
  @IsIn(['test', 'uat', 'production'])
  renderEnvironmentName?: 'test' | 'uat' | 'production';

  @IsOptional()
  @IsString()
  dockerContext?: string;

  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
```

- [ ] **Step 3: Update direct deployment target DTO**

Mirror the same fields in `src/modules/env-provisioning/dto/create-deployment-target.dto.ts`.

- [ ] **Step 4: Update frontend contract types**

In `cicd-workflow-fe/src/lib/api/contracts.ts`, update `DeploymentStrategy`:

```ts
export type DeploymentStrategy =
  | "provider_native"
  | "vercel_git_connected"
  | "vercel_ci_pushed"
  | "render_git_connected"
  | "render_image_pushed"
  | "render_existing_service";
```

Add:

```ts
export type RenderServiceType =
  | "web_service"
  | "private_service"
  | "background_worker"
  | "cron_job";

export type RenderDeployMethod =
  | "managed_image"
  | "byo_image"
  | "native_git"
  | "existing_service";
```

Extend `DeploymentProvisioningTargetRequest`, `DeploymentTarget`, and `DeploymentProvisioningResult.targets[number]` with the Render fields from Step 2.

- [ ] **Step 5: Run focused type tests**

Backend:

```powershell
npm test -- projects.service.spec.ts
```

Expected: may fail until implementation tasks add mapping logic; failures should be type/expectation related, not syntax errors.

Frontend:

```powershell
npm test -- env-provisioning-api.test.ts
```

Expected: may fail until UI/API tests are updated; TypeScript parsing should succeed.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/env-provisioning/env-provisioning.types.ts src/modules/projects/dto/create-project.dto.ts src/modules/env-provisioning/dto/create-deployment-target.dto.ts
git commit -m "feat: extend render provisioning contracts"
```

Frontend commit:

```powershell
git add src/lib/api/contracts.ts
git commit -m "feat: extend render provisioning contract types"
```

---

## Task 2: Add Migration For Render Deployment Metadata

**Files:**
- Create: `cicd-workflow-be/supabase/migrations/20260611_render_deployment_provisioning.sql`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.repository.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.repository.spec.ts`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260611_render_deployment_provisioning.sql`:

```sql
BEGIN;

ALTER TABLE env_provisioning.project_deployment_targets
  ADD COLUMN IF NOT EXISTS render_service_type TEXT,
  ADD COLUMN IF NOT EXISTS render_instance_type TEXT,
  ADD COLUMN IF NOT EXISTS render_region TEXT,
  ADD COLUMN IF NOT EXISTS render_environment_name TEXT,
  ADD COLUMN IF NOT EXISTS docker_context TEXT,
  ADD COLUMN IF NOT EXISTS dockerfile_path TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

UPDATE env_provisioning.project_deployment_targets
SET deployment_strategy = 'render_git_connected'
WHERE provider = 'render'
  AND deployment_strategy = 'provider_native';

UPDATE env_provisioning.project_deployment_targets
SET render_service_type = COALESCE(render_service_type, 'web_service'),
    render_environment_name = COALESCE(render_environment_name, branch_name)
WHERE provider = 'render';

ALTER TABLE env_provisioning.project_deployment_targets
  DROP CONSTRAINT IF EXISTS project_deployment_targets_strategy_check;

ALTER TABLE env_provisioning.project_deployment_targets
  ADD CONSTRAINT project_deployment_targets_strategy_check
  CHECK (
    deployment_strategy IN (
      'provider_native',
      'vercel_git_connected',
      'vercel_ci_pushed',
      'render_git_connected',
      'render_image_pushed',
      'render_existing_service'
    )
  );

ALTER TABLE env_provisioning.project_deployment_targets
  ADD CONSTRAINT project_deployment_targets_render_service_type_check
  CHECK (
    render_service_type IS NULL OR render_service_type IN (
      'web_service',
      'private_service',
      'background_worker',
      'cron_job'
    )
  );

ALTER TABLE env_provisioning.project_deployment_targets
  ADD CONSTRAINT project_deployment_targets_render_environment_check
  CHECK (
    render_environment_name IS NULL OR render_environment_name IN (
      'test',
      'uat',
      'production'
    )
  );

CREATE INDEX IF NOT EXISTS idx_project_deployment_targets_render_service_type
  ON env_provisioning.project_deployment_targets (render_service_type)
  WHERE provider = 'render';

CREATE INDEX IF NOT EXISTS idx_project_deployment_targets_render_environment
  ON env_provisioning.project_deployment_targets (render_environment_name)
  WHERE provider = 'render';

COMMIT;
```

- [ ] **Step 2: Make repository persist new fields**

Update `CreateDeploymentTargetInput`, `DeploymentTargetRow`, insert SQL, insert values, and `toSummary()` in `deployment-targets.repository.ts`.

The insert column list must include:

```sql
render_service_type,
render_instance_type,
render_region,
render_environment_name,
docker_context,
dockerfile_path,
image_url
```

The insert values must append:

```ts
input.renderServiceType ?? null,
input.renderInstanceType ?? null,
input.renderRegion ?? null,
input.renderEnvironmentName ?? null,
input.dockerContext ?? null,
input.dockerfilePath ?? null,
input.imageUrl ?? null,
```

- [ ] **Step 3: Add repository test**

In `deployment-targets.repository.spec.ts`, add a mapping test that verifies a row with Render metadata maps to `DeploymentTargetSummary`:

```ts
expect(summary).toMatchObject({
  provider: 'render',
  deploymentStrategy: 'render_image_pushed',
  renderServiceType: 'web_service',
  renderInstanceType: 'free',
  renderRegion: 'singapore',
  renderEnvironmentName: 'test',
  dockerContext: 'backend',
  dockerfilePath: 'backend/Dockerfile',
  imageUrl: 'ghcr.io/cicd-external-project/demo-backend:test',
});
```

- [ ] **Step 4: Run migration-oriented tests**

```powershell
npm test -- env-provisioning/deployment-targets.repository.spec.ts
```

Expected: PASS after repository mapping is complete.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260611_render_deployment_provisioning.sql src/modules/env-provisioning/deployment-targets.repository.ts src/modules/env-provisioning/deployment-targets.repository.spec.ts
git commit -m "feat: store render deployment metadata"
```

---

## Task 3: Add Managed Render Config And Cost Policy

**Files:**
- Modify: `cicd-workflow-be/src/config/app.config.ts`
- Modify: `cicd-workflow-be/src/common/config/env.validation.ts`
- Create: `cicd-workflow-be/src/modules/env-provisioning/render-cost-policy.service.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-provisioning.module.ts`
- Test: `cicd-workflow-be/src/config/app.config.spec.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/render-cost-policy.service.spec.ts`

- [ ] **Step 1: Add config shape**

Extend `AppConfig['envProvisioning']['flowciManaged']`:

```ts
renderToken: string;
renderOwnerId: string | null;
renderDefaultRegion: string;
renderDefaultInstanceType: string;
renderAllowedInstanceTypes: string[];
renderAllowPaidManaged: boolean;
renderManagedMaxServicesPerUser: number;
renderBootstrapImage: string;
renderRegistryUsername: string | null;
renderRegistryToken: string | null;
```

Populate from env:

```ts
renderDefaultRegion: env['FLOWCI_RENDER_DEFAULT_REGION'] ?? 'singapore',
renderDefaultInstanceType: env['FLOWCI_RENDER_DEFAULT_INSTANCE_TYPE'] ?? 'free',
renderAllowedInstanceTypes: (env['FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES'] ?? 'free')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean),
renderAllowPaidManaged: env['FLOWCI_RENDER_ALLOW_PAID_MANAGED'] === 'true',
renderManagedMaxServicesPerUser: Number(env['FLOWCI_RENDER_MANAGED_MAX_SERVICES_PER_USER'] ?? '2'),
renderBootstrapImage:
  env['FLOWCI_RENDER_BOOTSTRAP_IMAGE'] ??
  'docker.io/library/nginx:alpine',
renderRegistryUsername: env['FLOWCI_RENDER_REGISTRY_USERNAME']?.trim() || null,
renderRegistryToken: env['FLOWCI_RENDER_REGISTRY_TOKEN']?.trim() || null,
```

- [ ] **Step 2: Add env validation entries**

In `env.validation.ts`, add optional entries:

```ts
FLOWCI_RENDER_DEFAULT_REGION?: string;
FLOWCI_RENDER_DEFAULT_INSTANCE_TYPE?: string;
FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES?: string;
FLOWCI_RENDER_ALLOW_PAID_MANAGED?: string;
FLOWCI_RENDER_MANAGED_MAX_SERVICES_PER_USER?: string;
FLOWCI_RENDER_BOOTSTRAP_IMAGE?: string;
FLOWCI_RENDER_REGISTRY_USERNAME?: string;
FLOWCI_RENDER_REGISTRY_TOKEN?: string;
```

- [ ] **Step 3: Create cost policy service**

Create `render-cost-policy.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type { EnvOwnershipMode, RenderServiceType } from './env-provisioning.types';

const FREE_SUPPORTED_SERVICE_TYPES: RenderServiceType[] = ['web_service'];

@Injectable()
export class RenderCostPolicyService {
  constructor(private readonly configService: ConfigService) {}

  resolveManagedDefaults(input: {
    ownershipMode: EnvOwnershipMode;
    serviceType?: RenderServiceType | null;
    instanceType?: string | null;
    region?: string | null;
  }): { serviceType: RenderServiceType; instanceType: string; region: string } {
    const config = this.configService.getOrThrow<AppConfig>('app');
    const serviceType = input.serviceType ?? 'web_service';
    const instanceType =
      input.instanceType?.trim() ||
      config.envProvisioning.flowciManaged.renderDefaultInstanceType;
    const region =
      input.region?.trim() ||
      config.envProvisioning.flowciManaged.renderDefaultRegion;

    if (input.ownershipMode === 'flowci_managed') {
      this.assertManagedAllowed(serviceType, instanceType);
    }

    return { serviceType, instanceType, region };
  }

  assertManagedAllowed(serviceType: RenderServiceType, instanceType: string): void {
    const config = this.configService.getOrThrow<AppConfig>('app');
    const allowed = config.envProvisioning.flowciManaged.renderAllowedInstanceTypes;
    if (!allowed.includes(instanceType)) {
      throw new BadRequestException(
        `FlowCI-managed Render does not allow instance type '${instanceType}'. Choose one of: ${allowed.join(', ')}.`,
      );
    }

    const freeLike = instanceType === 'free';
    if (freeLike && !FREE_SUPPORTED_SERVICE_TYPES.includes(serviceType)) {
      throw new BadRequestException(
        `Render service type '${serviceType}' cannot use the managed free default. Choose a web service or use BYO Render.`,
      );
    }

    if (!freeLike && !config.envProvisioning.flowciManaged.renderAllowPaidManaged) {
      throw new BadRequestException(
        'Managed paid Render provisioning is disabled. Use the free default or connect your own Render account.',
      );
    }
  }
}
```

- [ ] **Step 4: Register service**

Add `RenderCostPolicyService` to `EnvProvisioningModule.providers`.

- [ ] **Step 5: Add tests**

Test cases:

```ts
it('defaults managed Render to free web service in the configured region', () => {});
it('rejects paid managed Render instance types when paid provisioning is disabled', () => {});
it('rejects free managed workers because free web service is the only free default', () => {});
it('allows BYO paid instance metadata without managed paid flag', () => {});
```

- [ ] **Step 6: Run tests**

```powershell
npm test -- config/app.config.spec.ts env-provisioning/render-cost-policy.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/config/app.config.ts src/common/config/env.validation.ts src/modules/env-provisioning/render-cost-policy.service.ts src/modules/env-provisioning/render-cost-policy.service.spec.ts src/modules/env-provisioning/env-provisioning.module.ts
git commit -m "feat: add managed render cost policy"
```

---

## Task 4: Resolve Render Deployment Strategies

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-strategy.resolver.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`
- Test: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.spec.ts`

- [ ] **Step 1: Update resolver input**

Change resolver input to include Render method/action:

```ts
export interface ResolveDeploymentStrategyInput {
  provider: EnvProvider;
  ownershipMode: EnvOwnershipMode;
  action?: 'create' | 'register_existing';
  renderDeployMethod?: RenderDeployMethod;
}
```

- [ ] **Step 2: Implement strategy logic**

Use this behavior:

```ts
resolve(input: ResolveDeploymentStrategyInput): DeploymentStrategy {
  if (input.provider === 'vercel') {
    return 'vercel_ci_pushed';
  }

  if (input.provider === 'render') {
    if (input.action === 'register_existing' || input.renderDeployMethod === 'existing_service') {
      return 'render_existing_service';
    }

    if (input.ownershipMode === 'flowci_managed') {
      return 'render_image_pushed';
    }

    if (input.renderDeployMethod === 'byo_image') {
      return 'render_image_pushed';
    }

    return 'render_git_connected';
  }

  return 'provider_native';
}
```

- [ ] **Step 3: Pass new fields from service**

In `deployment-targets.service.ts`, pass:

```ts
const deploymentStrategy = this.deploymentStrategyResolver.resolve({
  provider: dto.provider,
  ownershipMode: dto.ownershipMode,
  action: dto.action,
  renderDeployMethod: dto.renderDeployMethod,
});
```

- [ ] **Step 4: Add resolver tests**

Test cases:

```ts
expect(resolve({ provider: 'render', ownershipMode: 'flowci_managed' })).toBe('render_image_pushed');
expect(resolve({ provider: 'render', ownershipMode: 'byo', renderDeployMethod: 'byo_image' })).toBe('render_image_pushed');
expect(resolve({ provider: 'render', ownershipMode: 'byo', renderDeployMethod: 'native_git' })).toBe('render_git_connected');
expect(resolve({ provider: 'render', ownershipMode: 'byo', action: 'register_existing' })).toBe('render_existing_service');
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- env-provisioning/deployment-strategy.resolver.spec.ts env-provisioning/deployment-targets.service.spec.ts
```

Expected: PASS after service wiring is complete.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/env-provisioning/deployment-strategy.resolver.ts src/modules/env-provisioning/deployment-strategy.resolver.spec.ts src/modules/env-provisioning/deployment-targets.service.ts src/modules/env-provisioning/deployment-targets.service.spec.ts
git commit -m "feat: resolve render deployment strategies"
```

---

## Task 5: Implement Render Image-Backed Service Creation

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/runtime-env-provider.client.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/render-env.client.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/render-env.client.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`

- [ ] **Step 1: Extend provider create input**

In `runtime-env-provider.client.ts`, extend `CreateProviderTargetInput`:

```ts
renderServiceType?: RenderServiceType;
renderInstanceType?: string;
renderRegion?: string;
renderEnvironmentName?: RenderEnvironmentName;
dockerContext?: string;
dockerfilePath?: string;
imageUrl?: string;
```

- [ ] **Step 2: Add Render payload builder**

In `render-env.client.ts`, add:

```ts
private buildCreateServiceBody(input: CreateProviderTargetInput, ownerId: string) {
  if (input.deploymentStrategy === 'render_image_pushed') {
    const imagePath = input.imageUrl ?? this.getBootstrapImage();
    return {
      type: input.renderServiceType ?? 'web_service',
      name: input.projectName,
      ownerId,
      image: {
        imagePath,
      },
      envVars: this.defaultRenderEnvVars(input),
      serviceDetails: this.serviceDetails(input),
    };
  }

  return {
    type: input.renderServiceType ?? 'web_service',
    name: input.projectName,
    ownerId,
    repo: `https://github.com/${input.repoFullName}`,
    branch: input.branchName,
    rootDir: input.rootDirectory,
    buildCommand: input.buildCommand,
    startCommand: input.startCommand,
    serviceDetails: this.serviceDetails(input),
  };
}
```

Use the config bootstrap image:

```ts
private getBootstrapImage(): string {
  const config = this.configService?.getOrThrow<AppConfig>('app');
  return (
    config?.envProvisioning.flowciManaged.renderBootstrapImage ??
    'docker.io/library/nginx:alpine'
  );
}
```

- [ ] **Step 3: Store provider metadata**

Return metadata from `createTarget()`:

```ts
metadata: {
  deploymentStrategy: input.deploymentStrategy,
  renderServiceType: input.renderServiceType ?? 'web_service',
  renderInstanceType: input.renderInstanceType ?? null,
  renderRegion: input.renderRegion ?? null,
  renderEnvironmentName: input.renderEnvironmentName ?? input.branchName,
  dockerContext: input.dockerContext ?? input.rootDirectory ?? '.',
  dockerfilePath: input.dockerfilePath ?? 'Dockerfile',
  imageUrl: input.imageUrl ?? null,
  bootstrapImage:
    input.deploymentStrategy === 'render_image_pushed'
      ? this.getBootstrapImage()
      : null,
}
```

- [ ] **Step 4: Normalize Render errors**

Replace `assertOk()` with an async implementation:

```ts
private async assertOk(response: Response, message: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  if (response.status === 402) {
    throw new Error(
      'Render billing is not configured for this workspace or the selected instance type requires payment.',
    );
  }
  if (response.status === 409) {
    throw new Error(
      'A Render service with this name already exists in the selected workspace.',
    );
  }
  if (response.status === 401) {
    throw new Error('Render API key is invalid or missing required workspace access.');
  }

  throw new Error(`${message}: ${response.status}${body ? ` ${body.slice(0, 300)}` : ''}`);
}
```

Update all call sites to `await this.assertOk(...)`.

- [ ] **Step 5: Add tests**

Add tests:

```ts
it('creates image-backed Render services with the configured bootstrap image', async () => {});
it('creates BYO native Git Render services when strategy is render_git_connected', async () => {});
it('returns a clean 402 billing error', async () => {});
it('returns a clean duplicate service name error for 409', async () => {});
it('stores image deployment metadata for Render targets', async () => {});
```

- [ ] **Step 6: Run tests**

```powershell
npm test -- env-provisioning/provider-clients/render-env.client.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/env-provisioning/provider-clients/runtime-env-provider.client.ts src/modules/env-provisioning/provider-clients/render-env.client.ts src/modules/env-provisioning/provider-clients/render-env.client.spec.ts src/modules/env-provisioning/deployment-targets.service.ts
git commit -m "feat: create image-backed render services"
```

---

## Task 6: Install Render Deploy Secrets Into GitHub

**Files:**
- Create: `cicd-workflow-be/src/modules/env-provisioning/render-ci-secrets.service.ts`
- Create: `cicd-workflow-be/src/modules/env-provisioning/render-ci-secrets.service.spec.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/env-provisioning.module.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/project-deployment-provisioning.service.ts`

- [ ] **Step 1: Create secret service**

Create `render-ci-secrets.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';

import { GithubService } from '../github/github.service';
import type { DeploymentTargetSummary, EnvTargetSlot } from './env-provisioning.types';

export interface RenderCiSecretNames {
  apiKey: string;
  serviceId: string;
  ownerId: string;
  registryCredentialId: string;
}

@Injectable()
export class RenderCiSecretsService {
  constructor(private readonly githubService: GithubService) {}

  async installForTarget(input: {
    githubAccessToken: string;
    repoFullName: string;
    target: DeploymentTargetSummary;
  }): Promise<{ githubSecrets: RenderCiSecretNames }> {
    if (
      input.target.provider !== 'render' ||
      !['render_image_pushed', 'render_existing_service'].includes(input.target.deploymentStrategy)
    ) {
      return { githubSecrets: this.renderSecretNames(input.target.slot) };
    }

    const apiKey = this.requireProviderMetadataString(input.target.providerMetadata, 'renderApiKey');
    const serviceId = this.requireProviderMetadataString(
      input.target.providerMetadata,
      'renderServiceId',
    );
    const ownerId = this.requireProviderMetadataString(input.target.providerMetadata, 'renderOwnerId');
    const registryCredentialId = this.optionalProviderMetadataString(
      input.target.providerMetadata,
      'renderRegistryCredentialId',
    );
    const [owner, repo] = this.parseRepoFullName(input.repoFullName);
    const secretNames = this.renderSecretNames(input.target.slot);

    await this.githubService.setActionsSecretStrict(
      input.githubAccessToken,
      owner,
      repo,
      secretNames.apiKey,
      apiKey,
    );
    await this.githubService.setActionsSecretStrict(
      input.githubAccessToken,
      owner,
      repo,
      secretNames.serviceId,
      serviceId,
    );
    await this.githubService.setActionsSecretStrict(
      input.githubAccessToken,
      owner,
      repo,
      secretNames.ownerId,
      ownerId,
    );
    if (registryCredentialId) {
      await this.githubService.setActionsSecretStrict(
        input.githubAccessToken,
        owner,
        repo,
        secretNames.registryCredentialId,
        registryCredentialId,
      );
    }

    return { githubSecrets: secretNames };
  }

  renderSecretNames(slot: EnvTargetSlot): RenderCiSecretNames {
    return {
      apiKey: `RENDER_${slot.toUpperCase()}_API_KEY`,
      serviceId: `RENDER_${slot.toUpperCase()}_SERVICE_ID`,
      ownerId: `RENDER_${slot.toUpperCase()}_OWNER_ID`,
      registryCredentialId: `RENDER_${slot.toUpperCase()}_REGISTRY_CREDENTIAL_ID`,
    };
  }

  private parseRepoFullName(repoFullName: string): [string, string] {
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      throw new BadRequestException(`Invalid repoFullName '${repoFullName}'. Expected owner/repo.`);
    }
    return [owner, repo];
  }

  private requireProviderMetadataString(metadata: Record<string, unknown>, key: string): string {
    const value = metadata[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`Render provider metadata is missing ${key}`);
    }
    return value.trim();
  }

  private optionalProviderMetadataString(metadata: Record<string, unknown>, key: string): string | null {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
```

- [ ] **Step 2: Register service**

Add `RenderCiSecretsService` to `EnvProvisioningModule.providers`.

- [ ] **Step 3: Wire provisioning service**

Inject `RenderCiSecretsService` in `project-deployment-provisioning.service.ts`.

After target creation, add:

```ts
if (
  target.provider === 'render' &&
  ['render_image_pushed', 'render_existing_service'].includes(target.deploymentStrategy)
) {
  if (!input.githubAccessToken) {
    throw new Error('GitHub access token is required to install Render deployment secrets');
  }

  const secretResult = await this.renderCiSecretsService.installForTarget({
    githubAccessToken: input.githubAccessToken,
    repoFullName: input.repoFullName,
    target,
  });

  providerMetadata = {
    ...providerMetadata,
    githubSecrets: secretResult.githubSecrets,
  };
  await this.deploymentTargetsService.updateProviderMetadata(target.id, providerMetadata);
}
```

- [ ] **Step 4: Add tests**

Test cases:

```ts
it('installs per-slot Render API deployment secrets for image-pushed targets', async () => {});
it('does not install secrets for render_git_connected targets', async () => {});
it('requires renderServiceId metadata for image-pushed targets', async () => {});
it('installs optional registry credential id when present', async () => {});
it('adds Render githubSecrets metadata to the provisioning result', async () => {});
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- env-provisioning/render-ci-secrets.service.spec.ts env-provisioning/project-deployment-provisioning.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/env-provisioning/render-ci-secrets.service.ts src/modules/env-provisioning/render-ci-secrets.service.spec.ts src/modules/env-provisioning/env-provisioning.module.ts src/modules/env-provisioning/project-deployment-provisioning.service.ts src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
git commit -m "feat: install render deploy secrets"
```

---

## Task 7: Generate Optimized Dockerfiles For Render Backends

**Files:**
- Modify: `cicd-workflow-be/src/modules/projects/scaffold.builder.ts`
- Modify: `cicd-workflow-be/src/modules/projects/scaffold.builder.spec.ts`

- [ ] **Step 1: Replace Dockerfile builder**

Update `buildDockerfile(nodeVersion: string)` to:

```ts
function buildDockerfile(nodeVersion: string): string {
  return [
    `FROM node:${nodeVersion}-alpine AS deps`,
    'WORKDIR /app',
    'COPY package*.json ./',
    'RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi',
    '',
    `FROM node:${nodeVersion}-alpine AS builder`,
    'WORKDIR /app',
    'COPY --from=deps /app/node_modules ./node_modules',
    'COPY . .',
    'RUN npm run build',
    '',
    `FROM node:${nodeVersion}-alpine AS runner`,
    'WORKDIR /app',
    'ENV NODE_ENV=production',
    'ENV PORT=3000',
    'RUN addgroup -S nodejs && adduser -S flowci -G nodejs',
    'COPY package*.json ./',
    'RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi',
    'COPY --from=builder --chown=flowci:nodejs /app/dist ./dist',
    'USER flowci',
    'EXPOSE 3000',
    'CMD ["node", "dist/main.js"]',
  ].join('\\n');
}
```

- [ ] **Step 2: Replace dockerignore builder**

Use:

```ts
function buildDockerignore(): string {
  return [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.env',
    '.env.*',
    '!.env.example',
    '.git',
    '.github',
    '*.log',
    'npm-debug.log*',
  ].join('\\n');
}
```

- [ ] **Step 3: Add scaffold tests**

Add tests:

```ts
it('generates optimized Dockerfile for standalone backend scaffolds', () => {});
it('generates backend/Dockerfile for microservices backend scaffolds', () => {});
it('does not generate frontend Dockerfile for Vercel frontend targets', () => {});
it('generates .dockerignore next to each generated backend Dockerfile', () => {});
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- projects/scaffold.builder.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/projects/scaffold.builder.ts src/modules/projects/scaffold.builder.spec.ts
git commit -m "feat: optimize generated render dockerfiles"
```

---

## Task 8: Generate Render Image Deployment Workflow Jobs

**Files:**
- Modify: `cicd-workflow-be/src/modules/workflows/dto/generate-workflow.dto.ts`
- Modify: `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.ts`
- Modify: `cicd-workflow-be/src/modules/workflows/staged-workflow.builder.spec.ts`
- Modify: `cicd-workflow-be/src/modules/workflows/workflows.service.spec.ts`
- Modify: `cicd-workflow-be/src/modules/projects/projects.service.ts`

- [ ] **Step 1: Extend workflow target DTO**

In `generate-workflow.dto.ts`, extend `DeploymentWorkflowTarget`:

```ts
deploymentStrategy:
  | 'vercel_ci_pushed'
  | 'render_image_pushed'
  | 'render_git_connected'
  | 'render_existing_service';
secretNames?: {
  token?: string;
  orgId?: string;
  projectId?: string;
  apiKey?: string;
  serviceId?: string;
  ownerId?: string;
  registryCredentialId?: string;
};
dockerContext?: string | null;
dockerfilePath?: string | null;
imageName?: string | null;
renderServiceType?: string | null;
renderInstanceType?: string | null;
```

- [ ] **Step 2: Replace single Render deploy job**

In `staged-workflow.builder.ts`, replace:

```ts
...(deploymentProvider === 'render' && {
  'deploy-render': renderDeployJob(serviceName),
}),
```

with target-based jobs:

```ts
...renderDeployJobs(serviceName, servicePath, deploymentTargets),
```

- [ ] **Step 3: Add Render job builder**

Add:

```ts
function renderDeployJobs(
  serviceName: string,
  servicePath: string,
  targets: DeploymentWorkflowTarget[],
) {
  return Object.fromEntries(
    targets
      .filter((target) => target.deploymentStrategy === 'render_image_pushed')
      .map((target) => [
        `deploy-render-${target.slot}`,
        {
          needs: ['build'],
          uses: `${CENTRAL_WORKFLOW_REF}/render-deploy.yml@v1`,
          if: protectedDeployBranchExpression(),
          with: {
            'system-name': target.slot === 'standalone' ? serviceName : target.slot,
            environment:
              "${{ (github.event.workflow_run.head_branch || github.ref_name) == 'main' && 'production' || github.event.workflow_run.head_branch || github.ref_name }}",
            branch: '${{ github.event.workflow_run.head_branch || github.ref_name }}',
            'working-directory': target.rootDirectory ?? servicePath,
            'docker-context': target.dockerContext ?? target.rootDirectory ?? servicePath,
            'dockerfile-path': target.dockerfilePath ?? 'Dockerfile',
            'image-name': target.imageName ?? `flowci-${target.slot}`,
            'checkout-ref': '${{ github.event.workflow_run.head_sha || github.sha }}',
          },
          secrets: {
            RENDER_API_KEY: `\${{ secrets.${target.secretNames?.apiKey ?? `RENDER_${target.slot.toUpperCase()}_API_KEY`} }}`,
            RENDER_SERVICE_ID: `\${{ secrets.${target.secretNames?.serviceId ?? `RENDER_${target.slot.toUpperCase()}_SERVICE_ID`} }}`,
            RENDER_OWNER_ID: `\${{ secrets.${target.secretNames?.ownerId ?? `RENDER_${target.slot.toUpperCase()}_OWNER_ID`} }}`,
            RENDER_REGISTRY_CREDENTIAL_ID: `\${{ secrets.${target.secretNames?.registryCredentialId ?? `RENDER_${target.slot.toUpperCase()}_REGISTRY_CREDENTIAL_ID`} }}`,
          },
        },
      ]),
  );
}
```

- [ ] **Step 4: Map project deployment targets**

In `projects.service.ts`, when converting deployment provisioning result to workflow deployment targets, map Render target metadata:

```ts
if (target.provider === 'render' && target.deploymentStrategy === 'render_image_pushed') {
  return {
    slot: target.slot,
    provider: 'render',
    deploymentStrategy: 'render_image_pushed',
    rootDirectory: target.rootDirectory,
    dockerContext:
      typeof target.providerMetadata?.dockerContext === 'string'
        ? target.providerMetadata.dockerContext
        : target.rootDirectory ?? '.',
    dockerfilePath:
      typeof target.providerMetadata?.dockerfilePath === 'string'
        ? target.providerMetadata.dockerfilePath
        : 'Dockerfile',
    imageName: `${target.repoFullName.replace('/', '-')}-${target.slot}`,
    secretNames:
      typeof target.providerMetadata?.githubSecrets === 'object'
        ? target.providerMetadata.githubSecrets
        : undefined,
  };
}
```

- [ ] **Step 5: Add workflow tests**

Test cases:

```ts
it('adds Render image deployment jobs with per-slot Render API deployment secrets', () => {});
it('uses backend root directory as Docker context for monorepo backend targets', () => {});
it('does not add Render deploy jobs for render_git_connected targets', () => {});
it('keeps package workflow packages: write for GHCR pushes', () => {});
```

- [ ] **Step 6: Validate generated YAML**

Run:

```powershell
npm test -- workflows/staged-workflow.builder.spec.ts workflows/workflows.service.spec.ts projects/projects.service.spec.ts
```

Expected: PASS and js-yaml parsing succeeds for generated workflows.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/workflows/dto/generate-workflow.dto.ts src/modules/workflows/staged-workflow.builder.ts src/modules/workflows/staged-workflow.builder.spec.ts src/modules/workflows/workflows.service.spec.ts src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat: generate render image deploy jobs"
```

---

## Task 9: Update Central Render Reusable Workflow

**Files:**
- Modify: `cicd-workflow/.github/workflows/render-deploy.yml`
- Create: `cicd-workflow/docs/workflows/render-deploy.md`

- [ ] **Step 1: Replace reusable workflow contract**

Update `.github/workflows/render-deploy.yml`:

```yaml
# Contract: docs/workflows/render-deploy.md
name: "Reusable: Render Image Deploy"

on:
  workflow_call:
    inputs:
      system-name:
        required: true
        type: string
      environment:
        required: false
        type: string
        default: "test"
      branch:
        required: false
        type: string
        default: ""
      working-directory:
        required: false
        type: string
        default: "."
      docker-context:
        required: false
        type: string
        default: "."
      dockerfile-path:
        required: false
        type: string
        default: "Dockerfile"
      image-name:
        required: true
        type: string
      checkout-ref:
        required: false
        type: string
        default: ""
    secrets:
      RENDER_API_KEY:
        required: true
      RENDER_SERVICE_ID:
        required: true
      RENDER_OWNER_ID:
        required: true
      RENDER_REGISTRY_CREDENTIAL_ID:
        required: false

permissions:
  contents: read
  packages: write

jobs:
  render-deploy:
    name: "Build image and deploy ${{ inputs.system-name }} to Render"
    if: ${{ contains(fromJSON('["test","uat","main"]'), inputs.branch || github.ref_name) }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ inputs.checkout-ref || github.sha }}

      - uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}

      - name: Compute image tag
        id: image
        shell: bash
        run: |
          SAFE_BRANCH="$(printf '%s' '${{ inputs.branch || github.ref_name }}' | tr '/[:upper:]' '-[:lower:]')"
          IMAGE="ghcr.io/${{ github.repository_owner }}/${{ inputs.image-name }}:${SAFE_BRANCH}-${{ github.sha }}"
          echo "image=${IMAGE}" >> "$GITHUB_OUTPUT"

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: ${{ inputs.docker-context }}
          file: ${{ inputs.dockerfile-path }}
          push: true
          tags: ${{ steps.image.outputs.image }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Point Render service at pushed image
        shell: bash
        env:
          RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
          RENDER_SERVICE_ID: ${{ secrets.RENDER_SERVICE_ID }}
          RENDER_OWNER_ID: ${{ secrets.RENDER_OWNER_ID }}
          RENDER_REGISTRY_CREDENTIAL_ID: ${{ secrets.RENDER_REGISTRY_CREDENTIAL_ID }}
          IMAGE_URL: ${{ steps.image.outputs.image }}
        run: |
          python - <<'PY'
import json
import os

image = {
  "ownerId": os.environ["RENDER_OWNER_ID"],
  "imagePath": os.environ["IMAGE_URL"],
}
credential_id = os.environ.get("RENDER_REGISTRY_CREDENTIAL_ID", "").strip()
if credential_id:
  image["registryCredentialId"] = credential_id

with open("render-image-payload.json", "w", encoding="utf-8") as payload:
  json.dump({"image": image}, payload)
PY
          curl -fsS -X PATCH "https://api.render.com/v1/services/${RENDER_SERVICE_ID}" \
            -H "Authorization: Bearer ${RENDER_API_KEY}" \
            -H "Content-Type: application/json" \
            --data @render-image-payload.json

      - name: Trigger Render deploy
        shell: bash
        env:
          RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
          RENDER_SERVICE_ID: ${{ secrets.RENDER_SERVICE_ID }}
          IMAGE_URL: ${{ steps.image.outputs.image }}
        run: |
          python - <<'PY'
import json
import os

with open("render-deploy-payload.json", "w", encoding="utf-8") as payload:
  json.dump({"imageUrl": os.environ["IMAGE_URL"]}, payload)
PY
          curl -fsS -X POST "https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys" \
            -H "Authorization: Bearer ${RENDER_API_KEY}" \
            -H "Content-Type: application/json" \
            --data @render-deploy-payload.json
          echo "Triggered Render image deploy for ${{ inputs.system-name }}."
```

- [ ] **Step 2: Keep Render image config and deploy payload separate**

The Render API deploy endpoint only accepts `imageUrl` when the service is already configured for the same image host, repository, and image name. Keep both API calls:

```text
PATCH /v1/services/{serviceId}
  body: { "image": { "ownerId": "...", "imagePath": "ghcr.io/org/name:tag", "registryCredentialId": "..." } }

POST /v1/services/{serviceId}/deploys
  body: { "imageUrl": "ghcr.io/org/name:tag" }
```

- [ ] **Step 3: Add docs**

Create `docs/workflows/render-deploy.md`:

```md
# Render Image Deploy Reusable Workflow

Builds a Docker image from a caller repository, pushes it to GHCR, updates the Render service image configuration, then triggers a Render deploy with the pushed image URL.

Required secrets:

- `RENDER_API_KEY`
- `RENDER_SERVICE_ID`
- `RENDER_OWNER_ID`

Optional secret:

- `RENDER_REGISTRY_CREDENTIAL_ID`

Required input:

- `image-name`

Important permissions:

- `contents: read`
- `packages: write`

The caller must pass a Docker context and Dockerfile path that match the service root. Monorepo backend services normally use `docker-context: backend` and `dockerfile-path: backend/Dockerfile`.
```

- [ ] **Step 4: Run local YAML validation**

```powershell
npm run build
```

Expected: no YAML syntax failure in workflow validation if this repo has validation wired to build. If no build script exists, parse YAML with the existing workflow validation script or `js-yaml` fallback used in this repository.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/render-deploy.yml docs/workflows/render-deploy.md
git commit -m "feat: deploy render from pushed images"
```

---

## Task 10: Add Existing Render Service Attachment

**Files:**
- Modify: `cicd-workflow-be/src/modules/env-provisioning/provider-clients/render-env.client.ts`
- Modify: `cicd-workflow-be/src/modules/env-provisioning/deployment-targets.service.ts`
- Modify: `cicd-workflow-fe/src/components/product/deployment-provisioning-setup.tsx`
- Test: backend and frontend deployment provisioning tests

- [ ] **Step 1: Backend target registration behavior**

For `dto.action === 'register_existing'` and `provider === 'render'`, require:

```ts
providerProjectId
providerProjectName
```

Allow optional provider metadata fields:

```ts
renderOwnerId
renderRegistryCredentialId
renderServiceType
renderInstanceType
renderRegion
```

Store strategy as `render_existing_service`.

- [ ] **Step 2: Validate Render deploy API metadata for image/existing strategy**

When strategy is `render_existing_service`, install Render API deployment secrets only when service and owner metadata is present:

```ts
providerProjectId // Render service id
renderOwnerId
renderRegistryCredentialId // optional, only needed for private GHCR/registry images
```

If `renderOwnerId` is absent, mark the target inactive and return a clean error:

```ts
errorSummary: 'Render service registered, but Render owner ID is missing. Add the Render workspace owner ID before CI can deploy images.'
```

- [ ] **Step 3: Frontend existing service option**

Add advanced option:

```text
Render target
  Create new service
  Use existing service
```

When existing service is selected, show:

- Service ID
- Service name
- Render service ID
- Env vars

Hide:

- Build command
- Start command
- Docker context
- Dockerfile path

- [ ] **Step 4: Add tests**

Backend:

```ts
it('registers an existing Render service without calling create service API', async () => {});
it('stores Render API deploy metadata for existing Render services', async () => {});
```

Frontend:

```ts
it('renders existing Render service fields when use existing service is selected', () => {});
it('omits Docker fields for existing Render service attachment', () => {});
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/env-provisioning/provider-clients/render-env.client.ts src/modules/env-provisioning/deployment-targets.service.ts
git commit -m "feat: attach existing render services"
```

Frontend:

```powershell
git add src/components/product/deployment-provisioning-setup.tsx tests/unit/deployment-provisioning-setup.test.tsx
git commit -m "feat: add existing render service setup"
```

---

## Task 11: Update Frontend Render Provisioning UX

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/deployment-provisioning-setup.tsx`
- Modify: frontend styling file used by product components
- Modify: `cicd-workflow-fe/tests/unit/deployment-provisioning-setup.test.tsx`

- [ ] **Step 1: Fix BYO label**

Current UI hardcodes:

```tsx
<option value="byo">Use my Vercel account</option>
```

Change to provider-aware text:

```tsx
<option value="byo">Use my {target.provider === "render" ? "Render" : "Vercel"} account</option>
```

- [ ] **Step 2: Add Render defaults**

Update `fallbackTarget()`:

```ts
return {
  slot,
  provider,
  ownershipMode: "flowci_managed",
  branchName: "test",
  rootDirectory: provider === "render" && slot === "backend" ? "backend" : ".",
  buildCommand: provider === "render" ? "npm run build" : "npm run build",
  startCommand: provider === "render" ? "npm run start" : undefined,
  renderDeployMethod: provider === "render" ? "managed_image" : undefined,
  renderServiceType: provider === "render" ? "web_service" : undefined,
  renderInstanceType: provider === "render" ? "free" : undefined,
  renderRegion: provider === "render" ? "singapore" : undefined,
  renderEnvironmentName: "test",
  dockerContext: provider === "render" ? "." : undefined,
  dockerfilePath: provider === "render" ? "Dockerfile" : undefined,
  env: [{ environment: "test", vars: [] }],
};
```

For monorepo/microservices backend targets, set:

```ts
rootDirectory: "backend",
dockerContext: "backend",
dockerfilePath: "backend/Dockerfile",
```

- [ ] **Step 3: Add Render service controls**

When `target.provider === "render"`, show:

- Deployment method
  - Managed image deploy
  - Native Render build
  - Existing service
- Service type
- Instance type
- Region
- Environment

Only show Docker fields behind an advanced section:

```text
Packaging details
  Docker context
  Dockerfile path
```

Use copy:

```text
FlowCI packages and deploys this backend automatically.
```

Advanced copy:

```text
Uses a generated Dockerfile and GitHub Actions image deployment.
```

- [ ] **Step 4: Add cost warning**

If `renderInstanceType !== "free"` and `ownershipMode === "flowci_managed"`, show:

```text
Paid managed Render services require FlowCI approval. Use free or connect your own Render account.
```

- [ ] **Step 5: Add tests**

Test cases:

```ts
it('defaults managed Render to image deploy with free web service', () => {});
it('uses backend Docker context for monorepo backend targets', () => {});
it('shows BYO Render account text for Render targets', () => {});
it('hides Docker fields until packaging details is expanded', () => {});
it('shows paid managed Render warning for non-free instance type', () => {});
```

- [ ] **Step 6: Run frontend tests**

```powershell
npm test -- deployment-provisioning-setup.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/components/product/deployment-provisioning-setup.tsx tests/unit/deployment-provisioning-setup.test.tsx
git commit -m "feat: improve render provisioning setup ux"
```

---

## Task 12: Add Clean Render Errors And Result Status

**Files:**
- Modify: `cicd-workflow-fe/src/components/product/workflow-builder-utils.ts`
- Modify: `cicd-workflow-fe/src/components/product/setup-result-panel.tsx`
- Modify: `cicd-workflow-fe/tests/unit/workflow-builder-utils.test.ts`
- Modify: `cicd-workflow-fe/tests/unit/project-env-panel.test.tsx`

- [ ] **Step 1: Add Render error cleaner**

In `workflow-builder-utils.ts`, add cases:

```ts
if (/Render billing is not configured|selected instance type requires payment/i.test(message)) {
  return "Render billing is not configured for this workspace or the selected plan requires payment.";
}

if (/A Render service with this name already exists/i.test(message)) {
  return "A Render service with this name already exists. Choose a different service name or attach the existing service.";
}

if (/Render API key is invalid/i.test(message)) {
  return "The Render API key cannot access the selected workspace.";
}

if (/Render provider metadata is missing renderServiceId|Render provider metadata is missing renderOwnerId/i.test(message)) {
  return "Render service was created, but FlowCI could not install the Render API deployment secrets.";
}

if (/image pull|registry|GHCR/i.test(message)) {
  return "Render could not pull the deployment image. Check registry access and retry.";
}
```

- [ ] **Step 2: Update setup result panel**

For Render targets, show:

```text
Render
backend
Managed by FlowCI
Image deploy
web service · free · singapore
Render API deployment secrets installed
```

If the result only triggered deploy:

```text
Deploy triggered
```

Do not show:

```text
Deploy succeeded
```

unless backend later polls Render deployment status and returns a confirmed success.

- [ ] **Step 3: Add tests**

Test cases:

```ts
it('cleans Render billing errors', () => {});
it('cleans Render duplicate service errors', () => {});
it('renders Render image deploy metadata in setup result panel', () => {});
it('does not claim Render deployment completed when only the deploy API request was accepted', () => {});
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- workflow-builder-utils.test.ts project-env-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/product/workflow-builder-utils.ts src/components/product/setup-result-panel.tsx tests/unit/workflow-builder-utils.test.ts tests/unit/project-env-panel.test.tsx
git commit -m "feat: clarify render provisioning status"
```

---

## Task 13: Update Documentation And Env Shape

**Files:**
- Modify: `cicd-workflow-be/docs/deployment-provisioning.md`
- Create or modify: `cicd-workflow-be/.env.example`
- Create or modify: `cicd-workflow-fe/.env.example`

- [ ] **Step 1: Update deployment docs**

Replace provider strategy section with:

```text
vercel + any ownership + normal provisioning => vercel_ci_pushed
render + flowci_managed                     => render_image_pushed
render + byo + managed image option         => render_image_pushed
render + byo + native Git option            => render_git_connected
render + existing service                   => render_existing_service
```

- [ ] **Step 2: Add backend env shape**

Add:

```env
ENV_PROVISIONING_ENABLED=true

FLOWCI_RENDER_API_KEY=
FLOWCI_RENDER_OWNER_ID=
FLOWCI_RENDER_DEFAULT_REGION=singapore
FLOWCI_RENDER_DEFAULT_INSTANCE_TYPE=free
FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES=free
FLOWCI_RENDER_ALLOW_PAID_MANAGED=false
FLOWCI_RENDER_MANAGED_MAX_SERVICES_PER_USER=2
FLOWCI_RENDER_BOOTSTRAP_IMAGE=docker.io/library/nginx:alpine
FLOWCI_RENDER_REGISTRY_CREDENTIAL_ID=

FLOWCI_VERCEL_TOKEN=
FLOWCI_VERCEL_TEAM_ID=
FLOWCI_VERCEL_TEAM_SLUG=
```

- [ ] **Step 3: Add frontend env shape**

Add:

```env
NEXT_PUBLIC_API_URL=https://flowci-be-test.onrender.com
```

- [ ] **Step 4: Document operational setup**

Add operational checklist:

```text
1. Publish or verify FlowCI Render bootstrap image.
2. Configure Render API key and owner id in backend.
3. Configure registry credentials if using private GHCR images.
4. Keep managed paid Render disabled until quotas and billing review are accepted.
5. Create a backend project with managed Render.
6. Confirm Render service is created from bootstrap image.
7. Confirm GitHub repo has RENDER_BACKEND_API_KEY, RENDER_BACKEND_SERVICE_ID, and RENDER_BACKEND_OWNER_ID.
8. Push to test and confirm GitHub Actions builds/pushes GHCR image.
9. Confirm the Render workflow PATCHes the service image and then calls the Render deploy API with imageUrl.
```

- [ ] **Step 5: Commit**

```powershell
git add docs/deployment-provisioning.md .env.example
git commit -m "docs: document render image provisioning"
```

Frontend:

```powershell
git add .env.example
git commit -m "docs: document frontend env shape"
```

---

## Task 14: Full Verification

**Files:**
- No code files unless tests expose defects.

- [ ] **Step 1: Backend focused tests**

```powershell
npm test -- env-provisioning/deployment-strategy.resolver.spec.ts env-provisioning/provider-clients/render-env.client.spec.ts env-provisioning/render-ci-secrets.service.spec.ts env-provisioning/project-deployment-provisioning.service.spec.ts env-provisioning/deployment-targets.service.spec.ts projects/projects.service.spec.ts workflows/staged-workflow.builder.spec.ts workflows/workflows.service.spec.ts projects/scaffold.builder.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Backend full quality**

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: PASS.

- [ ] **Step 3: Frontend focused tests**

```powershell
npm test -- deployment-provisioning-setup.test.tsx workflow-builder-utils.test.ts project-env-panel.test.tsx env-provisioning-api.test.ts
```

Expected: PASS.

- [ ] **Step 4: Frontend full quality**

```powershell
npm run lint
npm run build
npm test
```

Expected: PASS.

- [ ] **Step 5: Central workflow validation**

Run the repository’s workflow validation command if present. If no command exists, parse the workflow with a small js-yaml check from an existing Node environment:

```powershell
node -e "const fs=require('fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/render-deploy.yml','utf8')); console.log('valid')"
```

Expected: `valid`.

- [ ] **Step 6: Manual test with mocks**

Use mocked provider clients:

```text
1. Enable ENV_PROVISIONING_ENABLED.
2. Create a backend project with Managed by FlowCI + Render.
3. Confirm request payload includes renderDeployMethod=managed_image, renderServiceType=web_service, renderInstanceType=free.
4. Confirm setup result shows image deploy and Render API deployment secrets.
5. Confirm generated package workflow contains deploy-render-backend.
6. Confirm deploy-render-backend calls central render-deploy.yml.
```

- [ ] **Step 7: Live test with real Render test workspace**

```text
1. Configure FLOWCI_RENDER_API_KEY and FLOWCI_RENDER_OWNER_ID for the test workspace.
2. Confirm FLOWCI_RENDER_ALLOW_PAID_MANAGED=false.
3. Confirm FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES=free.
4. Create a backend project with managed Render.
5. Confirm a Render web service appears in the configured owner/workspace.
6. Confirm initial env vars are present in Render.
7. Confirm GitHub repo has RENDER_BACKEND_API_KEY, RENDER_BACKEND_SERVICE_ID, and RENDER_BACKEND_OWNER_ID.
8. Push to test.
9. Confirm package workflow builds and pushes GHCR image.
10. Confirm Render deployment is triggered with imageUrl.
```

- [ ] **Step 8: Commit fixes from verification**

If verification required fixes:

```powershell
git add <changed-files>
git commit -m "fix: stabilize render deployment provisioning"
```

---

## Rollback Plan

### Feature Flag Rollback

Set:

```env
ENV_PROVISIONING_ENABLED=false
```

Effect:

- UI hides provisioning.
- Existing project creation still works.
- Existing Render services remain untouched.

### Managed Paid Rollback

Set:

```env
FLOWCI_RENDER_ALLOW_PAID_MANAGED=false
FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES=free
```

Effect:

- Managed paid Render creation is rejected.
- BYO targets can still be registered/created.

### Database Rollback

The migration is additive except the strategy check constraint replacement. To roll back code while keeping data:

```sql
ALTER TABLE env_provisioning.project_deployment_targets
  DROP CONSTRAINT IF EXISTS project_deployment_targets_strategy_check;

ALTER TABLE env_provisioning.project_deployment_targets
  ADD CONSTRAINT project_deployment_targets_strategy_check
  CHECK (deployment_strategy IN ('provider_native', 'vercel_git_connected', 'vercel_ci_pushed'));

UPDATE env_provisioning.project_deployment_targets
SET deployment_strategy = 'provider_native'
WHERE deployment_strategy IN ('render_git_connected', 'render_image_pushed', 'render_existing_service');
```

Keep the added nullable columns in place. They are harmless to old code and safer than dropping production metadata.

### Render Resource Rollback

For failed live tests:

```text
1. Delete test Render service from Render dashboard or API.
2. Delete generated GitHub repository if it was created only for testing.
3. Revoke test Render deploy API if the service remains.
4. Delete GHCR test package versions if they were pushed.
```

---

## Final Acceptance Criteria

- Managed Render creates an image-backed Render service without requiring Render GitHub integration.
- Managed Render defaults to `web_service`, `free`, configured default region.
- Managed paid Render plans are blocked unless explicitly enabled.
- BYO Render supports native Git, image deploy, and existing service attach.
- Monorepo backend targets use backend root, backend Docker context, and backend Dockerfile.
- Generated backend scaffolds include optimized Dockerfile and `.dockerignore`.
- Generated package workflows build/push GHCR images and trigger the Render deploy API.
- GitHub repository secrets include deterministic `RENDER_<SLOT>_API_KEY`, `RENDER_<SLOT>_SERVICE_ID`, `RENDER_<SLOT>_OWNER_ID`, and optional `RENDER_<SLOT>_REGISTRY_CREDENTIAL_ID`.
- Setup result UI does not claim deployment success unless actual deployment status is confirmed.
- Render errors for 401, 402, 409, missing Render deploy API, and registry pull failures are clean.
- Existing Vercel `vercel_ci_pushed` behavior remains unchanged.
- All focused backend, frontend, and central workflow validation tests pass.

---

## Self-Review

- Spec coverage: Managed, BYO, existing service, monorepos, service types, cost controls, Docker optimization, bootstrap image, GHCR, Render deploy APIs, errors, docs, verification, and rollback are covered by explicit tasks.
- Placeholder scan: No placeholder markers, open-ended repair instructions, or unbounded catch-all steps remain.
- Type consistency: Strategy names are consistently `render_image_pushed`, `render_git_connected`, and `render_existing_service`; service type names match Render API values; frontend and backend contracts mirror each other.
- Scope check: This is a large but coherent single feature because all tasks serve one deploy strategy model and one UI flow. Tasks are split by code boundary so execution can be paused after any commit.

