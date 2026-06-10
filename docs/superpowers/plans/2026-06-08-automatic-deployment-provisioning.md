# Automatic Deployment Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FlowCI project setup so a new FlowCI project can optionally create matching Render/Vercel deployment targets and provision runtime env vars during the same setup flow.

**Architecture:** Keep GitHub project creation as the primary success path, then call a new backend orchestration service that creates provider targets and provisions env vars per project slot. Provider provisioning is opt-in from the setup UI, uses the existing env-provisioning module, stores only metadata, and returns a separate status so a Render/Vercel failure does not erase a successfully created GitHub project.

**Tech Stack:** NestJS, class-validator DTOs, existing Supabase/Postgres repositories, existing Render/Vercel provider clients, Next.js/React, Jest, ESLint.

---

## Current Gap

The current env-provisioning implementation has provider clients, deployment target APIs, env-var APIs, encrypted BYO provider connections, and frontend screens for manual provisioning after a FlowCI project exists.

The missing behavior is project-setup orchestration:

- `ProjectsService.createProject()` creates GitHub repos, branches, workflow files, and CI tokens, but does not create Render/Vercel targets.
- `ProjectsService.setupProject()` installs workflows into an existing repo, but does not create Render/Vercel targets.
- The setup form does not include provider target creation or first-run env vars.
- Existing provider client tests mock API calls; there is no live Render/Vercel E2E unless real credentials are supplied.

## Product Decision

Automatic provider creation is opt-in.

- Show a setup toggle labeled `Provision deployment target`.
- Default it on only when backend capabilities report env provisioning enabled and FlowCI-managed credentials are available for the selected project type.
- Let users turn it off when they only want GitHub CI.
- Keep the manual Environment Variables panel for later changes, retries, and existing projects.

## File Structure

Backend files:

- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\env-provisioning.module.ts`
  - Export services needed by project setup orchestration.
- Create: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\project-deployment-provisioning.service.ts`
  - Orchestrates provider target creation and env-var provisioning for newly created project rows.
- Create: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\project-deployment-provisioning.service.spec.ts`
  - Tests orchestration, slot mapping, partial failures, and non-storage of values.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\dto\create-project.dto.ts`
  - Adds optional `deploymentProvisioning` request shape.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\dto\setup-project.dto.ts`
  - Adds the same optional shape for existing-repo setup.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.ts`
  - Calls orchestration after each project row exists and includes provisioning status in responses.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.spec.ts`
  - Adds tests for automatic provider provisioning and failure isolation.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.module.ts`
  - Imports `EnvProvisioningModule` or provides the orchestration service through module exports.

Frontend files:

- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\contracts.ts`
  - Adds deployment provisioning request/response contracts.
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-deployment-provisioning-form.ts`
  - Owns setup-page provider target/env-var state and payload generation.
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\deployment-provisioning-setup.tsx`
  - Setup-page UI for opt-in provider creation and initial env vars.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-create-project-form.ts`
  - Accepts deployment provisioning state while building the create-project payload.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\workflow-setup-tab.tsx`
  - Renders the setup panel when capability is enabled.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\workflow-builder.tsx`
  - Wires capability and deployment provisioning state into project creation.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\setup-result-panel.tsx`
  - Shows GitHub setup result separately from Render/Vercel provisioning result.
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\workflow-builder-setup.test.tsx`
  - Verifies setup payload and result rendering.
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\deployment-provisioning-setup.test.tsx`
  - Tests the setup UI in isolation.

## Backend Request And Response Shape

Add these types in backend DTO files and mirror them in frontend contracts:

```ts
export class DeploymentProvisioningEnvVarDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  key!: string;

  @IsString()
  @MaxLength(16384)
  value!: string;
}

export class DeploymentProvisioningEnvSetDto {
  @IsIn(['test', 'uat', 'production'])
  environment!: 'test' | 'uat' | 'production';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningEnvVarDto)
  vars!: DeploymentProvisioningEnvVarDto[];
}

export class DeploymentProvisioningTargetDto {
  @IsIn(['backend', 'frontend', 'standalone'])
  slot!: 'backend' | 'frontend' | 'standalone';

  @IsIn(['render', 'vercel'])
  provider!: 'render' | 'vercel';

  @IsIn(['byo', 'flowci_managed'])
  ownershipMode!: 'byo' | 'flowci_managed';

  @IsOptional()
  @IsString()
  providerConnectionId?: string;

  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  rootDirectory?: string;

  @IsOptional()
  @IsString()
  buildCommand?: string;

  @IsOptional()
  @IsString()
  startCommand?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningEnvSetDto)
  env?: DeploymentProvisioningEnvSetDto[];
}

export class DeploymentProvisioningRequestDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningTargetDto)
  targets!: DeploymentProvisioningTargetDto[];
}
```

Response shape:

```ts
export interface DeploymentProvisioningResult {
  status: 'skipped' | 'completed' | 'partial' | 'failed';
  targets: Array<{
    slot: 'backend' | 'frontend' | 'standalone';
    provider: 'render' | 'vercel';
    status: 'created' | 'registered' | 'failed';
    deploymentTargetId: string | null;
    providerProjectId: string | null;
    providerProjectName: string | null;
    errorSummary: string | null;
    env: Array<{
      environment: 'test' | 'uat' | 'production';
      provisioned: Array<{ key: string; status: 'provisioned' }>;
      failed: Array<{ key: string; status: 'failed'; errorSummary: string }>;
    }>;
  }>;
}
```

## Task 1: Backend DTO And Contract Types

**Files:**
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\dto\create-project.dto.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\dto\setup-project.dto.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.ts`
- Test: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.spec.ts`

- [ ] **Step 1: Write failing DTO-aware service test**

Add a test that sends `deploymentProvisioning` to `createProject()` and expects the service response to include a skipped result until orchestration is wired:

```ts
it('accepts deployment provisioning input on project creation', async () => {
  const result = await service.createProject('user-1', 'tone', 'oauth-token', {
    repoName: 'orders-api',
    visibility: 'private',
    projectTypeId: 'nestjs-api',
    workflowRecipeId: 'backend-api-ci',
    serviceName: 'orders-api',
    deploymentProvisioning: {
      enabled: true,
      targets: [
        {
          slot: 'backend',
          provider: 'render',
          ownershipMode: 'flowci_managed',
          projectName: 'orders-api-test',
          branchName: 'test',
          rootDirectory: '.',
          buildCommand: 'npm ci && npm run build',
          startCommand: 'npm run start:prod',
          env: [
            {
              environment: 'test',
              vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
            },
          ],
        },
      ],
    },
  });

  expect(result.deploymentProvisioning).toEqual({
    status: 'skipped',
    targets: [],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --runInBand src/modules/projects/projects.service.spec.ts
```

Expected: FAIL because `deploymentProvisioning` is not in `CreateProjectDto` and response types do not include `deploymentProvisioning`.

- [ ] **Step 3: Add DTO classes**

Add the DTO classes from the "Backend Request And Response Shape" section to both `create-project.dto.ts` and `setup-project.dto.ts`. To avoid duplication, create them once in `create-project.dto.ts` and import them in `setup-project.dto.ts`.

Add to `CreateProjectDto`:

```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => DeploymentProvisioningRequestDto)
  deploymentProvisioning?: DeploymentProvisioningRequestDto;
```

Add to `SetupProjectDto`:

```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => DeploymentProvisioningRequestDto)
  deploymentProvisioning?: DeploymentProvisioningRequestDto;
```

- [ ] **Step 4: Add response type**

In `projects.service.ts`, add `DeploymentProvisioningResult` and add `deploymentProvisioning: DeploymentProvisioningResult` to `CreateProjectResponse` and `SetupProjectResponse`.

For now, return this constant from each response:

```ts
const skippedDeploymentProvisioning: DeploymentProvisioningResult = {
  status: 'skipped',
  targets: [],
};
```

- [ ] **Step 5: Run test to verify pass**

Run:

```powershell
npm test -- --runInBand src/modules/projects/projects.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/projects/dto src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat: add deployment provisioning project contract"
```

## Task 2: Backend Orchestration Service

**Files:**
- Create: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\project-deployment-provisioning.service.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\project-deployment-provisioning.service.spec.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\env-provisioning\env-provisioning.module.ts`

- [ ] **Step 1: Write failing orchestration test for target creation and env provisioning**

Create `project-deployment-provisioning.service.spec.ts`:

```ts
import { ProjectDeploymentProvisioningService } from './project-deployment-provisioning.service';

describe('ProjectDeploymentProvisioningService', () => {
  const deploymentTargetsService = {
    createDeploymentTarget: jest.fn(),
  };
  const envVarsService = {
    provisionEnvVars: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deploymentTargetsService.createDeploymentTarget.mockResolvedValue({
      id: 'target-1',
      provider: 'render',
      providerProjectId: 'srv-1',
      providerProjectName: 'orders-api-test',
    });
    envVarsService.provisionEnvVars.mockResolvedValue({
      provisioned: [{ key: 'DATABASE_URL', status: 'provisioned' }],
      failed: [],
    });
  });

  it('creates provider targets and provisions env vars without storing values in the result', async () => {
    const service = new ProjectDeploymentProvisioningService(
      deploymentTargetsService as never,
      envVarsService as never,
    );

    const result = await service.provisionForProject({
      projectId: 'project-1',
      userId: 'user-1',
      repoFullName: 'tone/orders-api',
      request: {
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
            branchName: 'test',
            rootDirectory: '.',
            buildCommand: 'npm ci && npm run build',
            startCommand: 'npm run start:prod',
            env: [
              {
                environment: 'test',
                vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
              },
            ],
          },
        ],
      },
    });

    expect(deploymentTargetsService.createDeploymentTarget).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      expect.objectContaining({
        action: 'create',
        provider: 'render',
        slot: 'backend',
      }),
    );
    expect(envVarsService.provisionEnvVars).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      {
        deploymentTargetId: 'target-1',
        environment: 'test',
        vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
      },
    );
    expect(JSON.stringify(result)).not.toContain('postgres://secret');
    expect(result.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run:

```powershell
npm test -- --runInBand src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement service**

Create `project-deployment-provisioning.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';

import type { DeploymentProvisioningRequestDto } from '../projects/dto/create-project.dto';
import type { DeploymentProvisioningResult } from '../projects/projects.service';
import { DeploymentTargetsService } from './deployment-targets.service';
import { EnvVarsService } from './env-vars.service';

interface ProvisionForProjectInput {
  projectId: string;
  userId: string;
  repoFullName: string;
  request?: DeploymentProvisioningRequestDto;
}

@Injectable()
export class ProjectDeploymentProvisioningService {
  private readonly logger = new Logger(ProjectDeploymentProvisioningService.name);

  constructor(
    private readonly deploymentTargetsService: DeploymentTargetsService,
    private readonly envVarsService: EnvVarsService,
  ) {}

  async provisionForProject(
    input: ProvisionForProjectInput,
  ): Promise<DeploymentProvisioningResult> {
    if (!input.request?.enabled || input.request.targets.length === 0) {
      return { status: 'skipped', targets: [] };
    }

    const targets: DeploymentProvisioningResult['targets'] = [];

    for (const requestedTarget of input.request.targets) {
      try {
        const target = await this.deploymentTargetsService.createDeploymentTarget(
          input.projectId,
          input.userId,
          {
            action: 'create',
            slot: requestedTarget.slot,
            ownershipMode: requestedTarget.ownershipMode,
            provider: requestedTarget.provider,
            providerConnectionId: requestedTarget.providerConnectionId,
            projectName: requestedTarget.projectName,
            branchName: requestedTarget.branchName ?? 'test',
            rootDirectory: requestedTarget.rootDirectory,
            buildCommand: requestedTarget.buildCommand,
            startCommand: requestedTarget.startCommand,
          },
        );

        const env: DeploymentProvisioningResult['targets'][number]['env'] = [];
        for (const envSet of requestedTarget.env ?? []) {
          const result = await this.envVarsService.provisionEnvVars(
            input.projectId,
            input.userId,
            {
              deploymentTargetId: target.id,
              environment: envSet.environment,
              vars: envSet.vars,
            },
          );
          env.push({
            environment: envSet.environment,
            provisioned: result.provisioned,
            failed: result.failed,
          });
        }

        targets.push({
          slot: requestedTarget.slot,
          provider: requestedTarget.provider,
          status: 'created',
          deploymentTargetId: target.id,
          providerProjectId: target.providerProjectId,
          providerProjectName: target.providerProjectName,
          errorSummary: null,
          env,
        });
      } catch (error) {
        this.logger.warn(
          `Deployment provisioning failed for ${input.repoFullName}/${requestedTarget.slot}: ${String(error)}`,
        );
        targets.push({
          slot: requestedTarget.slot,
          provider: requestedTarget.provider,
          status: 'failed',
          deploymentTargetId: null,
          providerProjectId: null,
          providerProjectName: null,
          errorSummary: this.sanitizeError(error),
          env: [],
        });
      }
    }

    const failedCount = targets.filter((target) => target.status === 'failed').length;
    return {
      status:
        failedCount === 0
          ? 'completed'
          : failedCount === targets.length
            ? 'failed'
            : 'partial',
      targets,
    };
  }

  private sanitizeError(error: unknown): string {
    return String(error)
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .slice(0, 500);
  }
}
```

- [ ] **Step 4: Export service from env module**

In `env-provisioning.module.ts`, add `ProjectDeploymentProvisioningService` to `providers` and `exports`.

- [ ] **Step 5: Run test to verify pass**

Run:

```powershell
npm test -- --runInBand src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/env-provisioning/project-deployment-provisioning.service.ts src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts src/modules/env-provisioning/env-provisioning.module.ts
git commit -m "feat: add project deployment provisioning service"
```

## Task 3: Wire Backend Orchestration Into Project Setup

**Files:**
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.module.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-be\src\modules\projects\projects.service.spec.ts`

- [ ] **Step 1: Write failing service test for orchestration call**

Update the test setup to inject a mocked `ProjectDeploymentProvisioningService`, then add:

```ts
it('provisions deployment targets after the GitHub project row exists', async () => {
  await service.createProject('user-1', 'tone', 'oauth-token', {
    repoName: 'orders-api',
    visibility: 'private',
    projectTypeId: 'nestjs-api',
    workflowRecipeId: 'backend-api-ci',
    serviceName: 'orders-api',
    deploymentProvisioning: {
      enabled: true,
      targets: [
        {
          slot: 'backend',
          provider: 'render',
          ownershipMode: 'flowci_managed',
          projectName: 'orders-api-test',
        },
      ],
    },
  });

  expect(projectDeploymentProvisioningService.provisionForProject).toHaveBeenCalledWith({
    projectId: 'project-1',
    userId: 'user-1',
    repoFullName: 'tone/orders-api',
    request: expect.objectContaining({ enabled: true }),
  });
});
```

- [ ] **Step 2: Write failure-isolation test**

Add:

```ts
it('returns the GitHub project when provider provisioning fails', async () => {
  projectDeploymentProvisioningService.provisionForProject.mockResolvedValueOnce({
    status: 'failed',
    targets: [
      {
        slot: 'backend',
        provider: 'render',
        status: 'failed',
        deploymentTargetId: null,
        providerProjectId: null,
        providerProjectName: null,
        errorSummary: 'Render service could not be created: 401',
        env: [],
      },
    ],
  });

  const result = await service.createProject('user-1', 'tone', 'oauth-token', {
    repoName: 'orders-api',
    visibility: 'private',
    projectTypeId: 'nestjs-api',
    workflowRecipeId: 'backend-api-ci',
    serviceName: 'orders-api',
    deploymentProvisioning: {
      enabled: true,
      targets: [
        {
          slot: 'backend',
          provider: 'render',
          ownershipMode: 'flowci_managed',
          projectName: 'orders-api-test',
        },
      ],
    },
  });

  expect(result.repoFullName).toBe('tone/orders-api');
  expect(result.deploymentProvisioning.status).toBe('failed');
});
```

- [ ] **Step 3: Run test to verify fail**

Run:

```powershell
npm test -- --runInBand src/modules/projects/projects.service.spec.ts
```

Expected: FAIL because `ProjectsService` does not inject or call the orchestration service.

- [ ] **Step 4: Inject and call orchestration**

In `ProjectsService` constructor, add:

```ts
private readonly projectDeploymentProvisioningService: ProjectDeploymentProvisioningService,
```

After each `projectsRepository.create()` call and `CI_TOKEN` secret installation, call:

```ts
const deploymentProvisioning =
  await this.projectDeploymentProvisioningService.provisionForProject({
    projectId: row.id,
    userId,
    repoFullName,
    request: dto.deploymentProvisioning,
  });
```

Return `deploymentProvisioning` in the response.

For microservices and multi-repo:

- Filter requested targets by slot.
- Call once for each created project row/repo pair.
- Merge the returned target arrays into one response.
- Set top-level status to `completed`, `partial`, `failed`, or `skipped` based on all target results.

- [ ] **Step 5: Wire module**

In `projects.module.ts`, import `EnvProvisioningModule` so `ProjectDeploymentProvisioningService` can be injected.

- [ ] **Step 6: Run focused backend tests**

Run:

```powershell
npm test -- --runInBand src/modules/projects/projects.service.spec.ts src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/projects src/modules/env-provisioning
git commit -m "feat: provision deployments during project setup"
```

## Task 4: Frontend Contracts And Payload Builder

**Files:**
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\contracts.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-create-project-form.ts`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\workflow-builder-setup.test.tsx`

- [ ] **Step 1: Write failing frontend payload test**

In `workflow-builder-setup.test.tsx`, add a test that enables deployment provisioning in the setup UI once Task 5 adds it. For this task, add contract-only expectations by testing the hook through the builder:

```ts
expect(mockedCreateProject).toHaveBeenCalledWith(
  expect.objectContaining({
    deploymentProvisioning: expect.objectContaining({
      enabled: true,
      targets: [
        expect.objectContaining({
          slot: 'backend',
          provider: 'render',
          ownershipMode: 'flowci_managed',
        }),
      ],
    }),
  }),
);
```

- [ ] **Step 2: Run test to verify fail**

Run:

```powershell
npm test -- --coverage=false tests/unit/workflow-builder-setup.test.tsx
```

Expected: FAIL because the request contract has no `deploymentProvisioning` field.

- [ ] **Step 3: Add frontend contract types**

In `contracts.ts`, add:

```ts
export interface DeploymentProvisioningEnvSet {
  environment: EnvEnvironment;
  vars: Array<{ key: string; value: string }>;
}

export interface DeploymentProvisioningTargetRequest {
  slot: EnvTargetSlot;
  provider: EnvProvider;
  ownershipMode: EnvOwnershipMode;
  providerConnectionId?: string;
  projectName?: string;
  branchName?: string;
  rootDirectory?: string;
  buildCommand?: string;
  startCommand?: string;
  env?: DeploymentProvisioningEnvSet[];
}

export interface DeploymentProvisioningRequest {
  enabled: boolean;
  targets: DeploymentProvisioningTargetRequest[];
}

export interface DeploymentProvisioningResult {
  status: 'skipped' | 'completed' | 'partial' | 'failed';
  targets: Array<{
    slot: EnvTargetSlot;
    provider: EnvProvider;
    status: 'created' | 'registered' | 'failed';
    deploymentTargetId: string | null;
    providerProjectId: string | null;
    providerProjectName: string | null;
    errorSummary: string | null;
    env: Array<{
      environment: EnvEnvironment;
      provisioned: Array<{ key: string; status: 'provisioned' }>;
      failed: Array<{ key: string; status: 'failed'; errorSummary: string }>;
    }>;
  }>;
}
```

Add `deploymentProvisioning?: DeploymentProvisioningRequest` to `CreateProjectRequest` and `SetupProjectRequest`.

Add `deploymentProvisioning?: DeploymentProvisioningResult` to `CreateProjectResponse`, `SetupProjectResponse`, and `CreateProjectResult`.

- [ ] **Step 4: Extend payload builder input**

In `use-create-project-form.ts`, add to `BuildPayloadInput`:

```ts
deploymentProvisioning?: CreateProjectRequest['deploymentProvisioning'];
```

Include this field in every returned payload:

```ts
...(input.deploymentProvisioning ? { deploymentProvisioning: input.deploymentProvisioning } : {}),
```

- [ ] **Step 5: Run focused frontend test**

Run:

```powershell
npm test -- --coverage=false tests/unit/workflow-builder-setup.test.tsx
```

Expected: PASS after Task 5 wires the UI; if Task 5 is not implemented yet, keep only type-level compile coverage here and finish the assertion in Task 5.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/api/contracts.ts src/hooks/use-create-project-form.ts tests/unit/workflow-builder-setup.test.tsx
git commit -m "feat: add deployment provisioning setup contract"
```

## Task 5: Frontend Setup UI

**Files:**
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-deployment-provisioning-form.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\deployment-provisioning-setup.tsx`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\workflow-setup-tab.tsx`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\workflow-builder.tsx`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\deployment-provisioning-setup.test.tsx`

- [ ] **Step 1: Write setup UI test**

Create `deployment-provisioning-setup.test.tsx` and assert:

```ts
it('builds a Render backend target with write-only env vars', () => {
  const onChange = jest.fn();
  render(
    <DeploymentProvisioningSetup
      enabled
      repoShape="single-app"
      selectedProjectKind="backend"
      value={{
        enabled: true,
        targets: [
          {
            slot: 'backend',
            provider: 'render',
            ownershipMode: 'flowci_managed',
            projectName: 'orders-api-test',
            branchName: 'test',
            rootDirectory: '.',
            buildCommand: 'npm ci && npm run build',
            startCommand: 'npm run start:prod',
            env: [{ environment: 'test', vars: [{ key: 'DATABASE_URL', value: '' }] }],
          },
        ],
      }}
      onChange={onChange}
    />,
  );

  expect(screen.getByText('Deployment provisioning')).toBeInTheDocument();
  expect(screen.getByLabelText('Provision deployment target')).toBeChecked();
  expect(screen.getByLabelText('Provider')).toHaveValue('render');
});
```

- [ ] **Step 2: Run test to verify fail**

Run:

```powershell
npm test -- --coverage=false tests/unit/deployment-provisioning-setup.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement hook**

Create `use-deployment-provisioning-form.ts` with:

```ts
import { useMemo, useState } from 'react';

import type { DeploymentProvisioningRequest, EnvTargetSlot } from '@/lib/api/contracts';

export function useDeploymentProvisioningForm() {
  const [enabled, setEnabled] = useState(false);
  const [request, setRequest] = useState<DeploymentProvisioningRequest>({
    enabled: false,
    targets: [],
  });

  function setDefaultTarget(slot: EnvTargetSlot, provider: 'render' | 'vercel', projectName: string) {
    setRequest({
      enabled: true,
      targets: [
        {
          slot,
          provider,
          ownershipMode: 'flowci_managed',
          projectName,
          branchName: 'test',
          rootDirectory: slot === 'frontend' ? 'frontend/' : '.',
          buildCommand: provider === 'render' ? 'npm ci && npm run build' : 'npm run build',
          startCommand: provider === 'render' ? 'npm run start:prod' : undefined,
          env: [{ environment: 'test', vars: [] }],
        },
      ],
    });
    setEnabled(true);
  }

  const payload = useMemo(
    () => (enabled ? { ...request, enabled: true } : undefined),
    [enabled, request],
  );

  return { enabled, payload, request, setDefaultTarget, setEnabled, setRequest };
}
```

- [ ] **Step 4: Implement component**

Create `deployment-provisioning-setup.tsx` with a compact setup panel:

- Checkbox: `Provision deployment target`
- Provider select: Render/Vercel
- Ownership select: FlowCI-managed/BYO
- Project name input
- Branch input default `test`
- Root directory input
- Build command input
- Start command input when provider is Render
- Env rows with key/value inputs
- Add/remove env row buttons

Every value input uses `type="password"` and helper text says:

```txt
Values are sent to the provider during setup and are not stored by FlowCI.
```

- [ ] **Step 5: Wire into setup tab and builder**

In `workflow-builder.tsx`, instantiate `useDeploymentProvisioningForm()` and pass it to `WorkflowSetupTab`.

When calling `form.buildPayload(...)`, include:

```ts
deploymentProvisioning: deploymentProvisioning.payload,
```

In `workflow-setup-tab.tsx`, render `DeploymentProvisioningSetup` inside the new project setup panel only when env provisioning capability is enabled.

- [ ] **Step 6: Run frontend setup tests**

Run:

```powershell
npm test -- --coverage=false tests/unit/deployment-provisioning-setup.test.tsx tests/unit/workflow-builder-setup.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/hooks/use-deployment-provisioning-form.ts src/components/product/deployment-provisioning-setup.tsx src/components/product/workflow-setup-tab.tsx src/components/product/workflow-builder.tsx tests/unit/deployment-provisioning-setup.test.tsx tests/unit/workflow-builder-setup.test.tsx
git commit -m "feat: add deployment provisioning setup ui"
```

## Task 6: Setup Result Status UI

**Files:**
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\setup-result-panel.tsx`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\workflow-builder-setup.test.tsx`

- [ ] **Step 1: Write failing result test**

Add a test that renders a `CreateProjectResult` with:

```ts
deploymentProvisioning: {
  status: 'partial',
  targets: [
    {
      slot: 'backend',
      provider: 'render',
      status: 'created',
      deploymentTargetId: 'target-1',
      providerProjectId: 'srv-1',
      providerProjectName: 'orders-api-test',
      errorSummary: null,
      env: [
        {
          environment: 'test',
          provisioned: [{ key: 'DATABASE_URL', status: 'provisioned' }],
          failed: [{ key: 'JWT_SECRET', status: 'failed', errorSummary: 'Render env vars could not be updated: 403' }],
        },
      ],
    },
  ],
}
```

Assert the UI shows:

```txt
Deployment provisioning
Render
orders-api-test
DATABASE_URL
JWT_SECRET
```

Assert it does not show any secret value.

- [ ] **Step 2: Run test to verify fail**

Run:

```powershell
npm test -- --coverage=false tests/unit/workflow-builder-setup.test.tsx
```

Expected: FAIL because setup result panel does not render provisioning status.

- [ ] **Step 3: Implement result panel**

Add a `Deployment provisioning` section below workflow files:

- `completed`: show all targets created and env keys provisioned.
- `partial`: show warning state and per-key failures.
- `failed`: show provider target failure summaries.
- `skipped` or undefined: render nothing.

Do not render env values; only render keys and sanitized error summaries.

- [ ] **Step 4: Run test to verify pass**

Run:

```powershell
npm test -- --coverage=false tests/unit/workflow-builder-setup.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/product/setup-result-panel.tsx tests/unit/workflow-builder-setup.test.tsx
git commit -m "feat: show deployment provisioning setup results"
```

## Task 7: Verification And PR Update

**Files:**
- Changed backend and frontend files.

- [ ] **Step 1: Backend verification**

Run in `C:\Codes\cicd-ex\cicd-workflow-be`:

```powershell
npm test -- --runInBand src/modules/projects/projects.service.spec.ts src/modules/env-provisioning/project-deployment-provisioning.service.spec.ts src/modules/env-provisioning/provider-clients/render-env.client.spec.ts src/modules/env-provisioning/provider-clients/vercel-env.client.spec.ts src/modules/env-provisioning/env-vars.service.spec.ts
npm run build
npx eslint src/modules/projects src/modules/env-provisioning src/config/app.config.ts src/common/config/env.validation.ts src/app.module.ts
git diff --check
```

Expected:

- Jest focused suites pass.
- Build exits 0.
- ESLint exits 0 for changed backend files.
- Diff check exits 0 or only CRLF warnings.

- [ ] **Step 2: Frontend verification**

Run in `C:\Codes\cicd-ex\cicd-workflow-fe`:

```powershell
npm test -- --coverage=false tests/unit/env-provisioning-api.test.ts tests/unit/deployment-providers-section.test.tsx tests/unit/project-env-panel.test.tsx tests/unit/deployment-provisioning-setup.test.tsx tests/unit/workflow-builder-setup.test.tsx
npm run lint
npm run build
git diff --check
```

Expected:

- Focused frontend tests pass.
- Lint exits 0 or only reports the known unrelated `reposError` warning in `src/app/home/page.tsx`.
- Build exits 0.
- Diff check exits 0 or only CRLF warnings.

- [ ] **Step 3: Browser QA**

Run the frontend locally and verify:

- Setup page shows the deployment provisioning section only when capability is enabled.
- Disabling the toggle omits `deploymentProvisioning` from the create request.
- Enabling the toggle includes target and env-key payload.
- Result panel shows provider target status.
- Secret values do not appear after submit.
- Mobile layout does not overflow.

- [ ] **Step 4: Push and update PRs**

Run in each changed repo:

```powershell
git status --short --branch
git push origin env-provisioning
gh pr view --json number,title,url,headRefName,baseRefName,state
```

Expected:

- Backend and frontend branches are pushed.
- Existing `env-provisioning -> test` PRs are updated or ready to create if missing.

## Live Provider Verification

The automated test suite must not create real Render/Vercel resources by default.

For live verification, use a separate manually triggered checklist after both provider tokens are available in the backend runtime:

1. Set `ENV_PROVISIONING_ENABLED=true`.
2. Set `ENV_PROVISIONING_ENCRYPTION_KEY`.
3. Set `FLOWCI_RENDER_API_KEY`.
4. Set `FLOWCI_VERCEL_TOKEN`.
5. Create a small backend test project with deployment provisioning enabled.
6. Confirm a Render service was created.
7. Confirm submitted test env keys exist in Render.
8. Create a small frontend test project with deployment provisioning enabled.
9. Confirm a Vercel project was created.
10. Confirm submitted test env keys exist in Vercel.
11. Delete the test provider resources manually after verification.

## Self-Review

- Spec coverage: The plan covers backend request contracts, orchestration, frontend setup payloads, setup UI, result UI, verification, and live provider verification.
- Placeholder scan: No task uses unresolved markers or undefined validation instructions.
- Type consistency: Request and response names are consistent across backend DTOs, backend service return types, and frontend contracts.
- Scope check: This plan does not add custom domains, DNS, deployment health checks, provider cleanup, or a secret vault. Those remain future hardening work.
