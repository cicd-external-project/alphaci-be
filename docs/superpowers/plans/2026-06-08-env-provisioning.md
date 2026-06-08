# Environment Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build feature-flagged website-driven deployment target creation and env-var provisioning that creates/selects Render/Vercel targets, then pushes write-only runtime env values for provisioned FlowCI projects.

**Architecture:** Add a backend Env Provisioning module that owns provider connections, encrypted provider tokens, provider target creation/selection, deployment target metadata, provider clients, and metadata-only env-var provisioning. Add frontend capability-aware settings and project env screens that create or select provider targets, submit values once, clear them, and show only metadata/status.

**Tech Stack:** NestJS, PostgreSQL/Supabase migrations, `pg`, Node `crypto`, Render REST API, Vercel REST API, Next.js/React, Jest, ESLint.

---

## Source Notes

- Vercel project env creation supports `upsert=true` on `POST /v10/projects/{idOrName}/env`.
- Vercel project creation is available through `POST /v11/projects`; the request can include Git repository link/configuration and returns a project id.
- Vercel env targets are `production`, `preview`, and `development`; FlowCI maps `test -> preview`, `uat -> preview`, and `production -> production` unless a custom env id is configured.
- Render service creation is available through `POST /v1/services`; the first target type for FlowCI is a web service backed by the project's GitHub repo and branch.
- Render service env-var update uses `PUT /v1/services/{serviceId}/env-vars` and replaces the env-var list, so the Render client must fetch existing vars and merge submitted keys before writing.
- Render env group single-key updates can use `PUT /v1/env-groups/{envGroupId}/env-vars/{envVarKey}` when the target is an env group.

## File Structure

Backend create:

- `supabase/migrations/20260608_env_provisioning.sql`: provider connections, deployment targets, env metadata tables, indexes, constraints, update triggers.
- `src/modules/env-provisioning/env-provisioning.module.ts`: module wiring.
- `src/modules/env-provisioning/env-provisioning.types.ts`: provider, environment, mode, target, metadata, and provision result types.
- `src/modules/env-provisioning/env-provisioning.config.ts`: feature flag and managed provider token config helpers.
- `src/modules/env-provisioning/encryption.service.ts`: AES-GCM token encryption/decryption.
- `src/modules/env-provisioning/env-feature.guard.ts`: blocks module routes when disabled.
- `src/modules/env-provisioning/dto/*.ts`: request DTOs.
- `src/modules/env-provisioning/provider-connections.repository.ts`: connection persistence.
- `src/modules/env-provisioning/deployment-targets.repository.ts`: target persistence.
- `src/modules/env-provisioning/env-vars.repository.ts`: metadata persistence.
- `src/modules/env-provisioning/provider-clients/runtime-env-provider.client.ts`: provider client interface.
- `src/modules/env-provisioning/provider-clients/render-env.client.ts`: Render API client.
- `src/modules/env-provisioning/provider-clients/vercel-env.client.ts`: Vercel API client.
- `src/modules/env-provisioning/provider-clients/provider-client.registry.ts`: provider selection.
- `src/modules/env-provisioning/provider-targets.service.ts`: common create-or-register target orchestration.
- `src/modules/env-provisioning/provider-connections.service.ts`: connection use cases.
- `src/modules/env-provisioning/deployment-targets.service.ts`: deployment target use cases.
- `src/modules/env-provisioning/env-vars.service.ts`: env provisioning use cases.
- `src/modules/env-provisioning/provider-connections.controller.ts`: `/provider-connections`.
- `src/modules/env-provisioning/deployment-targets.controller.ts`: `/projects/:projectId/deployment-targets`.
- `src/modules/env-provisioning/env-vars.controller.ts`: `/projects/:projectId/env-vars`.
- `src/modules/capabilities/capabilities.module.ts`, `src/modules/capabilities/capabilities.controller.ts`: backend capability response.

Backend modify:

- `src/config/app.config.ts`: add `envProvisioning` config.
- `src/common/config/env.validation.ts`: pass through and validate encryption key shape when feature is enabled.
- `src/app.module.ts`: import `EnvProvisioningModule` and `CapabilitiesModule`.
- `src/modules/projects/projects.repository.ts`: add `findByIdAndUser`.
- `.env.example`: document env provisioning vars.

Frontend create:

- `src/lib/api/capabilities.ts`: fetch backend capabilities.
- `src/lib/api/env-provisioning.ts`: provider connection, deployment target, and env-var API helpers.
- `src/hooks/use-capabilities.ts`: cached capabilities hook.
- `src/hooks/use-provider-connections.ts`: settings provider connection hook.
- `src/hooks/use-project-env-provisioning.ts`: project env provisioning hook.
- `src/components/settings/deployment-providers-section.tsx`: Render/Vercel token management.
- `src/components/product/project-env-panel.tsx`: project env-var provisioning panel.

Frontend modify:

- `src/lib/api/contracts.ts`: add capability/env provisioning contracts.
- `src/lib/api/client.ts`: export new API modules.
- `src/app/settings/page.tsx`: add Deployment Providers section.
- `src/components/product/workflow-current-tab.tsx`: add Environment Variables action for provisioned projects.
- `src/components/product/setup-result-panel.tsx`: add Configure env vars action after successful setup.

## Backend Tasks

### Task 1: Add Feature Flag And Capabilities

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `src/common/config/env.validation.ts`
- Create: `src/modules/capabilities/capabilities.module.ts`
- Create: `src/modules/capabilities/capabilities.controller.ts`
- Modify: `src/app.module.ts`
- Test: `src/modules/capabilities/capabilities.controller.spec.ts`

- [ ] **Step 1: Write failing capabilities tests**

Create `src/modules/capabilities/capabilities.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { CapabilitiesController } from './capabilities.controller';

const makeConfig = (enabled: boolean) =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        enabled,
      },
    }),
  }) as unknown as ConfigService;

describe('CapabilitiesController', () => {
  it('reports env provisioning enabled capabilities', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [{ provide: ConfigService, useValue: makeConfig(true) }],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: true,
        providers: ['render', 'vercel'],
        environments: ['test', 'uat', 'production'],
        modes: ['byo', 'flowci_managed'],
      },
    });
  });

  it('reports env provisioning disabled without provider lists', async () => {
    const module = await Test.createTestingModule({
      controllers: [CapabilitiesController],
      providers: [{ provide: ConfigService, useValue: makeConfig(false) }],
    }).compile();

    const controller = module.get(CapabilitiesController);

    expect(controller.getCapabilities()).toEqual({
      envProvisioning: {
        enabled: false,
        providers: [],
        environments: [],
        modes: [],
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --runInBand capabilities/capabilities.controller.spec.ts
```

Expected: FAIL because `CapabilitiesController` does not exist.

- [ ] **Step 3: Add config shape**

In `src/config/app.config.ts`, add to `AppConfig`:

```ts
  envProvisioning: {
    enabled: boolean;
    encryptionKey: string;
    flowciManaged: {
      renderToken: string;
      vercelToken: string;
      vercelTeamId: string | null;
      vercelTeamSlug: string | null;
    };
  };
```

Add to `appConfig` return:

```ts
    envProvisioning: {
      enabled: env['ENV_PROVISIONING_ENABLED'] === 'true',
      encryptionKey: env['ENV_PROVISIONING_ENCRYPTION_KEY'] ?? '',
      flowciManaged: {
        renderToken: env['FLOWCI_RENDER_API_KEY'] ?? '',
        vercelToken: env['FLOWCI_VERCEL_TOKEN'] ?? '',
        vercelTeamId: env['FLOWCI_VERCEL_TEAM_ID'] ?? null,
        vercelTeamSlug: env['FLOWCI_VERCEL_TEAM_SLUG'] ?? null,
      },
    },
```

- [ ] **Step 4: Add capability controller and module**

Create `src/modules/capabilities/capabilities.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';

@Controller('capabilities')
export class CapabilitiesController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getCapabilities() {
    const config = this.configService.getOrThrow<AppConfig>('app');
    const enabled = config.envProvisioning.enabled;

    return {
      envProvisioning: {
        enabled,
        providers: enabled ? ['render', 'vercel'] : [],
        environments: enabled ? ['test', 'uat', 'production'] : [],
        modes: enabled ? ['byo', 'flowci_managed'] : [],
      },
    };
  }
}
```

Create `src/modules/capabilities/capabilities.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { CapabilitiesController } from './capabilities.controller';

@Module({
  controllers: [CapabilitiesController],
})
export class CapabilitiesModule {}
```

Modify `src/app.module.ts`:

```ts
import { CapabilitiesModule } from './modules/capabilities/capabilities.module.js';
```

Add `CapabilitiesModule` to imports.

- [ ] **Step 5: Run test to verify pass**

Run:

```powershell
npm test -- --runInBand capabilities/capabilities.controller.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```powershell
git add src/config/app.config.ts src/app.module.ts src/modules/capabilities
git commit -m "feat: add env provisioning capabilities"
```

### Task 2: Add Env Provisioning Schema

**Files:**
- Create: `supabase/migrations/20260608_env_provisioning.sql`

- [ ] **Step 1: Add migration**

Create `supabase/migrations/20260608_env_provisioning.sql`:

```sql
-- Migration: env_provisioning
-- Stores provider connections, deployment targets, and metadata-only env var state.

CREATE TABLE IF NOT EXISTS provider_connections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('render', 'vercel')),
  label            TEXT        NOT NULL,
  encrypted_token  TEXT        NOT NULL,
  token_last_four  TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_user_provider
  ON provider_connections (user_id, provider, status);

CREATE TABLE IF NOT EXISTS project_deployment_targets (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 UUID        NOT NULL REFERENCES provisioned_projects(id) ON DELETE CASCADE,
  slot                       TEXT        NOT NULL CHECK (slot IN ('backend', 'frontend', 'standalone')),
  ownership_mode             TEXT        NOT NULL CHECK (ownership_mode IN ('byo', 'flowci_managed')),
  provider                   TEXT        NOT NULL CHECK (provider IN ('render', 'vercel')),
  provider_connection_id     UUID        NULL REFERENCES provider_connections(id) ON DELETE SET NULL,
  provider_project_id        TEXT        NOT NULL,
  provider_project_name      TEXT        NOT NULL,
  repo_full_name             TEXT        NOT NULL,
  branch_name                TEXT        NOT NULL,
  root_directory             TEXT        NULL,
  build_command              TEXT        NULL,
  start_command              TEXT        NULL,
  environment_map            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status                     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing', 'failed')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_deployment_targets_project
  ON project_deployment_targets (project_id, status);

CREATE TABLE IF NOT EXISTS project_env_var_metadata (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES provisioned_projects(id) ON DELETE CASCADE,
  deployment_target_id  UUID        NOT NULL REFERENCES project_deployment_targets(id) ON DELETE CASCADE,
  environment           TEXT        NOT NULL CHECK (environment IN ('test', 'uat', 'production')),
  key                   TEXT        NOT NULL,
  provider              TEXT        NOT NULL CHECK (provider IN ('render', 'vercel')),
  value_stored          BOOLEAN     NOT NULL DEFAULT false CHECK (value_stored = false),
  last_provisioned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_provisioned_by   UUID        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL CHECK (status IN ('provisioned', 'failed')),
  error_summary         TEXT        NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deployment_target_id, environment, key)
);

CREATE INDEX IF NOT EXISTS idx_project_env_var_metadata_project
  ON project_env_var_metadata (project_id, deployment_target_id, environment);

CREATE OR REPLACE FUNCTION set_env_provisioning_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_connections_updated_at ON provider_connections;
CREATE TRIGGER trg_provider_connections_updated_at
  BEFORE UPDATE ON provider_connections
  FOR EACH ROW EXECUTE FUNCTION set_env_provisioning_updated_at();

DROP TRIGGER IF EXISTS trg_project_deployment_targets_updated_at ON project_deployment_targets;
CREATE TRIGGER trg_project_deployment_targets_updated_at
  BEFORE UPDATE ON project_deployment_targets
  FOR EACH ROW EXECUTE FUNCTION set_env_provisioning_updated_at();

DROP TRIGGER IF EXISTS trg_project_env_var_metadata_updated_at ON project_env_var_metadata;
CREATE TRIGGER trg_project_env_var_metadata_updated_at
  BEFORE UPDATE ON project_env_var_metadata
  FOR EACH ROW EXECUTE FUNCTION set_env_provisioning_updated_at();
```

- [ ] **Step 2: Validate SQL syntax by inspection command**

Run:

```powershell
rg -n "CREATE TABLE IF NOT EXISTS provider_connections|project_deployment_targets|project_env_var_metadata|value_stored = false" supabase/migrations/20260608_env_provisioning.sql
git diff --check
```

Expected: all four table/constraint markers are found; `git diff --check` exits 0.

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260608_env_provisioning.sql
git commit -m "feat: add env provisioning schema"
```

### Task 3: Add Encryption Service

**Files:**
- Create: `src/modules/env-provisioning/encryption.service.ts`
- Test: `src/modules/env-provisioning/encryption.service.spec.ts`

- [ ] **Step 1: Write failing encryption tests**

Create `src/modules/env-provisioning/encryption.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { EnvTokenEncryptionService } from './encryption.service';

const key = Buffer.alloc(32, 7).toString('base64');

const makeConfig = () =>
  ({
    getOrThrow: jest.fn().mockReturnValue({
      envProvisioning: {
        encryptionKey: key,
      },
    }),
  }) as unknown as ConfigService;

describe('EnvTokenEncryptionService', () => {
  it('encrypts and decrypts provider tokens', () => {
    const service = new EnvTokenEncryptionService(makeConfig());
    const encrypted = service.encrypt('rnd_test_secret');

    expect(encrypted).not.toContain('rnd_test_secret');
    expect(service.decrypt(encrypted)).toBe('rnd_test_secret');
  });

  it('rejects malformed encryption keys', () => {
    const badConfig = {
      getOrThrow: jest.fn().mockReturnValue({
        envProvisioning: { encryptionKey: 'short' },
      }),
    } as unknown as ConfigService;

    expect(() => new EnvTokenEncryptionService(badConfig)).toThrow(
      /ENV_PROVISIONING_ENCRYPTION_KEY/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```powershell
npm test -- --runInBand env-provisioning/encryption.service.spec.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement encryption service**

Create `src/modules/env-provisioning/encryption.service.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';

@Injectable()
export class EnvTokenEncryptionService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<AppConfig>('app');
    this.key = Buffer.from(config.envProvisioning.encryptionKey, 'base64');

    if (this.key.length !== 32) {
      throw new Error(
        'ENV_PROVISIONING_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [version, ivRaw, tagRaw, encryptedRaw] = payload.split('.');
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
      throw new Error('Encrypted provider token payload is invalid');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```powershell
npm test -- --runInBand env-provisioning/encryption.service.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/env-provisioning/encryption.service.ts src/modules/env-provisioning/encryption.service.spec.ts
git commit -m "feat: add provider token encryption"
```

### Task 4: Add Backend Persistence Repositories

**Files:**
- Create: `src/modules/env-provisioning/env-provisioning.types.ts`
- Create: `src/modules/env-provisioning/provider-connections.repository.ts`
- Create: `src/modules/env-provisioning/deployment-targets.repository.ts`
- Create: `src/modules/env-provisioning/env-vars.repository.ts`
- Modify: `src/modules/projects/projects.repository.ts`
- Test: `src/modules/env-provisioning/*.repository.spec.ts`
- Test: `src/modules/projects/projects.repository.spec.ts`

- [ ] **Step 1: Write repository tests for metadata-only persistence**

Create tests that mock `DatabaseService.query` and assert:

```ts
expect(queryText).toContain('INSERT INTO provider_connections');
expect(queryText).toContain('encrypted_token');
expect(queryValues).not.toContain('plain-token');
```

For env metadata:

```ts
expect(queryText).toContain('INSERT INTO project_env_var_metadata');
expect(queryValues).toContain('DATABASE_URL');
expect(queryValues).not.toContain('postgres://secret');
```

- [ ] **Step 2: Add shared types**

Create `src/modules/env-provisioning/env-provisioning.types.ts`:

```ts
export type EnvProvider = 'render' | 'vercel';
export type EnvEnvironment = 'test' | 'uat' | 'production';
export type EnvOwnershipMode = 'byo' | 'flowci_managed';
export type EnvTargetSlot = 'backend' | 'frontend' | 'standalone';
export type ProviderConnectionStatus = 'active' | 'revoked' | 'failed';
export type DeploymentTargetStatus = 'active' | 'missing' | 'failed';
export type EnvVarProvisionStatus = 'provisioned' | 'failed';

export interface EnvVarInput {
  key: string;
  value: string;
}

export interface ProviderConnectionSummary {
  id: string;
  provider: EnvProvider;
  label: string;
  tokenLastFour: string;
  status: ProviderConnectionStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface DeploymentTargetSummary {
  id: string;
  projectId: string;
  slot: EnvTargetSlot;
  ownershipMode: EnvOwnershipMode;
  provider: EnvProvider;
  providerConnectionId: string | null;
  providerProjectId: string;
  providerProjectName: string;
  environmentMap: Record<string, unknown>;
  status: DeploymentTargetStatus;
}
```

- [ ] **Step 3: Implement repositories**

Implement each repository as a thin SQL wrapper following `ProjectsRepository` style. Methods required:

```ts
createProviderConnection(input): Promise<ProviderConnectionSummary>
listProviderConnections(userId: string): Promise<ProviderConnectionSummary[]>
findActiveProviderConnection(id: string, userId: string): Promise<{ encryptedToken: string } & ProviderConnectionSummary | null>
revokeProviderConnection(id: string, userId: string): Promise<boolean>
markProviderConnectionUsed(id: string): Promise<void>
```

```ts
createDeploymentTarget(input): Promise<DeploymentTargetSummary>
listDeploymentTargets(projectId: string): Promise<DeploymentTargetSummary[]>
findDeploymentTargetForUser(targetId: string, userId: string): Promise<DeploymentTargetSummary | null>
```

```ts
listEnvMetadata(projectId: string): Promise<EnvVarMetadata[]>
upsertEnvMetadataBatch(input): Promise<void>
```

Add to `ProjectsRepository`:

```ts
async findByIdAndUser(
  id: string,
  userId: string,
): Promise<ProvisionedProjectRow | null> {
  const result = await this.databaseService.query<ProvisionedProjectRow>(
    `
      SELECT *
      FROM provisioned_projects
      WHERE id = $1
        AND user_id = $2
      LIMIT 1;
    `,
    [id, userId],
  );

  return result.rows[0] ?? null;
}
```

- [ ] **Step 4: Run focused repository tests**

```powershell
npm test -- --runInBand env-provisioning projects/projects.repository.spec.ts
```

Expected: repository tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/env-provisioning src/modules/projects/projects.repository.ts src/modules/projects/projects.repository.spec.ts
git commit -m "feat: add env provisioning persistence"
```

### Task 5: Add Provider Clients

**Files:**
- Create: `src/modules/env-provisioning/provider-clients/runtime-env-provider.client.ts`
- Create: `src/modules/env-provisioning/provider-clients/render-env.client.ts`
- Create: `src/modules/env-provisioning/provider-clients/vercel-env.client.ts`
- Create: `src/modules/env-provisioning/provider-clients/provider-client.registry.ts`
- Test: provider client specs.

- [ ] **Step 1: Write Render client tests for merge-before-replace**

Test behavior:

```ts
global.fetch = jest
  .fn()
  .mockResolvedValueOnce({
    ok: true,
    json: async () => [
      { envVar: { key: 'EXISTING', value: 'keep' } },
      { envVar: { key: 'DATABASE_URL', value: 'old' } },
    ],
  })
  .mockResolvedValueOnce({
    ok: true,
    json: async () => [],
  }) as jest.Mock;

await client.upsertEnvironmentVariables({
  token: 'rnd',
  targetId: 'srv-1',
  environment: 'test',
  vars: [{ key: 'DATABASE_URL', value: 'new' }],
});

expect(fetch).toHaveBeenLastCalledWith(
  'https://api.render.com/v1/services/srv-1/env-vars',
  expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify([
      { key: 'EXISTING', value: 'keep' },
      { key: 'DATABASE_URL', value: 'new' },
    ]),
  }),
);
```

- [ ] **Step 2: Write Vercel client tests for `upsert=true`**

Test behavior:

```ts
await client.upsertEnvironmentVariables({
  token: 'vercel',
  targetId: 'prj-1',
  environment: 'production',
  vars: [{ key: 'NEXT_PUBLIC_API_URL', value: 'https://api.example.com' }],
});

expect(fetch).toHaveBeenCalledWith(
  'https://api.vercel.com/v10/projects/prj-1/env?upsert=true',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      key: 'NEXT_PUBLIC_API_URL',
      value: 'https://api.example.com',
      type: 'sensitive',
      target: ['production'],
    }),
  }),
);
```

- [ ] **Step 3: Implement provider interface**

Create `runtime-env-provider.client.ts`:

```ts
import type { EnvEnvironment, EnvProvider, EnvVarInput } from '../env-provisioning.types';

export interface ProviderAccountSummary {
  id: string;
  name: string;
}

export interface ProviderDeploymentTarget {
  id: string;
  name: string;
  provider: EnvProvider;
}

export interface ProviderProvisionResult {
  provisioned: Array<{ key: string; status: 'provisioned' }>;
  failed: Array<{ key: string; status: 'failed'; errorSummary: string }>;
}

export interface RuntimeEnvProviderClient {
  provider: EnvProvider;
  validateConnection(token: string): Promise<ProviderAccountSummary>;
  listTargets(token: string): Promise<ProviderDeploymentTarget[]>;
  createTarget(input: {
    token: string;
    repoFullName: string;
    projectName: string;
    branchName: string;
    rootDirectory?: string;
    buildCommand?: string;
    startCommand?: string;
  }): Promise<ProviderDeploymentTarget>;
  upsertEnvironmentVariables(input: {
    token: string;
    targetId: string;
    environment: EnvEnvironment;
    vars: EnvVarInput[];
  }): Promise<ProviderProvisionResult>;
}
```

- [ ] **Step 4: Write target creation tests**

Render create target test:

```ts
global.fetch = jest.fn().mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    service: {
      id: 'srv-1',
      name: 'api-service-test',
    },
  }),
}) as jest.Mock;

const target = await client.createTarget({
  token: 'rnd',
  repoFullName: 'owner/api-service',
  projectName: 'api-service-test',
  branchName: 'test',
  rootDirectory: '.',
  buildCommand: 'npm ci && npm run build',
  startCommand: 'npm run start:prod',
});

expect(target).toEqual({
  id: 'srv-1',
  name: 'api-service-test',
  provider: 'render',
});
expect(fetch).toHaveBeenCalledWith(
  'https://api.render.com/v1/services',
  expect.objectContaining({
    method: 'POST',
  }),
);
```

Vercel create target test:

```ts
global.fetch = jest.fn().mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    id: 'prj_1',
    name: 'web-app-test',
  }),
}) as jest.Mock;

const target = await client.createTarget({
  token: 'vercel',
  repoFullName: 'owner/web-app',
  projectName: 'web-app-test',
  branchName: 'test',
  rootDirectory: 'apps/web',
  buildCommand: 'npm run build',
});

expect(target).toEqual({
  id: 'prj_1',
  name: 'web-app-test',
  provider: 'vercel',
});
expect(fetch).toHaveBeenCalledWith(
  'https://api.vercel.com/v11/projects',
  expect.objectContaining({
    method: 'POST',
  }),
);
```

- [ ] **Step 5: Implement Render client**

Use:

```ts
POST https://api.render.com/v1/services
GET https://api.render.com/v1/services?limit=100
GET https://api.render.com/v1/services/{serviceId}/env-vars
PUT https://api.render.com/v1/services/{serviceId}/env-vars
```

Create Render web services from `repoFullName`, `branchName`, `rootDirectory`, `buildCommand`, and `startCommand`. Persist the returned service id as `providerProjectId`.

Implementation rule: current env vars are converted to `Map<string, string>`, submitted vars overwrite map entries, and the full map is written back.

- [ ] **Step 6: Implement Vercel client**

Use:

```ts
POST https://api.vercel.com/v11/projects
GET https://api.vercel.com/v9/projects
POST https://api.vercel.com/v10/projects/{projectId}/env?upsert=true
```

Create Vercel projects from `repoFullName`, `projectName`, `branchName`, and `rootDirectory`. Persist the returned project id as `providerProjectId`.

Target mapping:

```ts
const VERCEL_TARGET_BY_ENV = {
  test: 'preview',
  uat: 'preview',
  production: 'production',
} as const;
```

Use `type: 'sensitive'` for submitted values.

- [ ] **Step 7: Run provider client tests**

```powershell
npm test -- --runInBand env-provisioning/provider-clients
```

Expected: provider client tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/env-provisioning/provider-clients
git commit -m "feat: add runtime env provider clients"
```

### Task 6: Add Backend Services And Controllers

**Files:**
- Create: service/controller/DTO files under `src/modules/env-provisioning`
- Create: `src/modules/env-provisioning/env-provisioning.module.ts`
- Modify: `src/app.module.ts`
- Test: service/controller specs.

- [ ] **Step 1: Write service tests for write-only values**

Test `EnvVarsService.provisionEnvVars`:

```ts
expect(envVarsRepository.upsertEnvMetadataBatch).toHaveBeenCalledWith(
  expect.objectContaining({
    entries: [
      expect.objectContaining({
        key: 'DATABASE_URL',
        status: 'provisioned',
      }),
    ],
  }),
);
expect(JSON.stringify(envVarsRepository.upsertEnvMetadataBatch.mock.calls)).not.toContain('postgres://secret');
```

- [ ] **Step 2: Add DTOs**

Create DTOs with explicit validation methods in service rather than decorators:

```ts
export interface CreateProviderConnectionDto {
  provider: 'render' | 'vercel';
  label: string;
  token: string;
}

export interface CreateDeploymentTargetDto {
  action: 'create' | 'register_existing';
  slot: 'backend' | 'frontend' | 'standalone';
  ownershipMode: 'byo' | 'flowci_managed';
  provider: 'render' | 'vercel';
  providerConnectionId?: string;
  providerProjectId?: string;
  providerProjectName?: string;
  projectName?: string;
  branchName?: string;
  rootDirectory?: string;
  buildCommand?: string;
  startCommand?: string;
  environmentMap?: Record<string, unknown>;
}

export interface ProvisionEnvVarsDto {
  deploymentTargetId: string;
  environment: 'test' | 'uat' | 'production';
  vars: Array<{ key: string; value: string }>;
}
```

- [ ] **Step 3: Implement feature guard**

Create `env-feature.guard.ts`:

```ts
import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';

@Injectable()
export class EnvFeatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const config = this.configService.getOrThrow<AppConfig>('app');
    if (!config.envProvisioning.enabled) {
      throw new NotFoundException('Environment provisioning is not enabled');
    }
    return true;
  }
}
```

- [ ] **Step 4: Implement services**

Rules:

- Provider connection creation validates token with provider client before encrypting.
- Provider connection listing never returns encrypted token.
- Target creation verifies project ownership through `ProjectsRepository.findByIdAndUser`.
- Target creation creates a provider resource when `action` is `create`.
- Target creation registers an existing provider resource when `action` is `register_existing`.
- Env provisioning verifies project ownership through target lookup joined to project.
- Env key regex: `/^[A-Z_][A-Z0-9_]{1,127}$/`.
- Values must be strings with max length `16384`.
- Submitted values are passed to provider client only and not stored.

- [ ] **Step 5: Implement controllers**

Controllers:

```ts
@Controller('provider-connections')
@UseGuards(SessionAuthGuard, SubscriptionGuard, EnvFeatureGuard)
```

```ts
@Controller('projects/:projectId/deployment-targets')
@UseGuards(SessionAuthGuard, SubscriptionGuard, EnvFeatureGuard)
```

`POST /projects/:projectId/deployment-targets` create mode:

```json
{
  "action": "create",
  "slot": "backend",
  "ownershipMode": "flowci_managed",
  "provider": "render",
  "projectName": "api-service-test",
  "branchName": "test",
  "rootDirectory": ".",
  "buildCommand": "npm ci && npm run build",
  "startCommand": "npm run start:prod"
}
```

`POST /projects/:projectId/deployment-targets` register-existing mode:

```json
{
  "action": "register_existing",
  "slot": "frontend",
  "ownershipMode": "byo",
  "provider": "vercel",
  "providerConnectionId": "connection-id",
  "providerProjectId": "prj_123",
  "providerProjectName": "web-app"
}
```

```ts
@Controller('projects/:projectId/env-vars')
@UseGuards(SessionAuthGuard, SubscriptionGuard, EnvFeatureGuard)
```

- [ ] **Step 6: Wire module**

Create `env-provisioning.module.ts` with repositories, services, clients, registry, encryption service, controllers, and guards. Import `PersistenceModule`.

Add `EnvProvisioningModule` to `src/app.module.ts`.

- [ ] **Step 7: Run backend env provisioning tests**

```powershell
npm test -- --runInBand env-provisioning capabilities
```

Expected: all env provisioning and capabilities tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/env-provisioning src/modules/capabilities src/app.module.ts
git commit -m "feat: add env provisioning api"
```

### Task 7: Add Frontend Contracts And API Helpers

**Files:**
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\contracts.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\capabilities.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\env-provisioning.ts`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\lib\api\client.ts`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\env-provisioning-api.test.ts`

- [ ] **Step 1: Write failing frontend API tests**

Test fetch URLs and request payloads:

```ts
expect(fetch).toHaveBeenCalledWith(
  'http://localhost:4000/api/v1/projects/project-1/env-vars/provision',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      deploymentTargetId: 'target-1',
      environment: 'test',
      vars: [{ key: 'DATABASE_URL', value: 'secret' }],
    }),
  }),
);
```

- [ ] **Step 2: Add contract types**

Add:

```ts
export type EnvProvider = 'render' | 'vercel';
export type EnvEnvironment = 'test' | 'uat' | 'production';
export type EnvOwnershipMode = 'byo' | 'flowci_managed';
export type EnvTargetSlot = 'backend' | 'frontend' | 'standalone';
```

Add interfaces for `CapabilitiesResponse`, `ProviderConnection`, `DeploymentTarget`, `EnvVarMetadata`, and `ProvisionEnvVarsResponse`.

- [ ] **Step 3: Add API helpers**

Create `capabilities.ts`:

```ts
import { request } from './request';
import type { CapabilitiesResponse } from './contracts';

export function getCapabilities() {
  return request<CapabilitiesResponse>('/capabilities');
}
```

Create `env-provisioning.ts` with:

```ts
export function createProviderConnection(payload: CreateProviderConnectionRequest) {
  return request<ProviderConnection>('/provider-connections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

Add list/revoke/list targets/create target/list metadata/provision helpers.

- [ ] **Step 4: Run API tests**

```powershell
npm test -- --coverage=false tests/unit/env-provisioning-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit frontend API helpers**

```powershell
git add src/lib/api tests/unit/env-provisioning-api.test.ts
git commit -m "feat: add env provisioning api client"
```

### Task 8: Add Frontend Provider Connections UI

**Files:**
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-capabilities.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-provider-connections.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\settings\deployment-providers-section.tsx`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\app\settings\page.tsx`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\deployment-providers-section.test.tsx`

- [ ] **Step 1: Write UI tests**

Assert:

- Disabled capability hides provider section.
- Token input clears after successful submit.
- Saved connection shows provider, label, suffix, and status.
- Revoke button calls API and refreshes list.

- [ ] **Step 2: Implement hooks**

`useCapabilities` loads `/capabilities` and exposes `envProvisioningEnabled`.

`useProviderConnections` loads, creates, and revokes provider connections. It stores the token only in local component state until submit completes.

- [ ] **Step 3: Implement settings section**

Use existing `SettingsSection` visual style. Add a `Deployment Providers` tab or section. The form includes:

- Provider select: Render, Vercel.
- Label input.
- Token password input.
- Save button.

Required copy:

```txt
Provider tokens are stored encrypted so FlowCI can provision env vars for your projects.
Application env var values are not stored by FlowCI.
```

- [ ] **Step 4: Run focused frontend tests**

```powershell
npm test -- --coverage=false tests/unit/deployment-providers-section.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/use-capabilities.ts src/hooks/use-provider-connections.ts src/components/settings/deployment-providers-section.tsx src/app/settings/page.tsx tests/unit/deployment-providers-section.test.tsx
git commit -m "feat: add deployment provider settings"
```

### Task 9: Add Project Env Provisioning UI

**Files:**
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\hooks\use-project-env-provisioning.ts`
- Create: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\project-env-panel.tsx`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\workflow-current-tab.tsx`
- Modify: `C:\Codes\cicd-ex\cicd-workflow-fe\src\components\product\setup-result-panel.tsx`
- Test: `C:\Codes\cicd-ex\cicd-workflow-fe\tests\unit\project-env-panel.test.tsx`

- [ ] **Step 1: Write UI tests**

Assert:

- Only provisioned projects show Environment Variables action.
- Values clear after successful provisioning.
- Metadata table shows keys/status and never values.
- Failed keys show sanitized error summaries.
- Disabled capability hides action.

- [ ] **Step 2: Implement env hook**

The hook loads:

- deployment targets for selected project
- env metadata for selected project
- provider connections for target selection

It exposes `provision(values)` and clears caller-provided values on success or partial result.

- [ ] **Step 3: Implement panel**

The panel contains:

- Deployment target select.
- Target action selector: create a new target or use an existing target.
- Build/start command fields when creating Render backend targets.
- Root directory field for monorepos and microservices.
- Environment segmented control: `test`, `uat`, `production`.
- Editable rows for key/value.
- Add row and remove row buttons.
- Submit button.
- Metadata table.

Validation:

- Key regex `/^[A-Z_][A-Z0-9_]{1,127}$/`.
- Value required.
- Duplicate keys in the same submission rejected client-side.

- [ ] **Step 4: Run focused frontend test**

```powershell
npm test -- --coverage=false tests/unit/project-env-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/use-project-env-provisioning.ts src/components/product/project-env-panel.tsx src/components/product/workflow-current-tab.tsx src/components/product/setup-result-panel.tsx tests/unit/project-env-panel.test.tsx
git commit -m "feat: add project env provisioning ui"
```

### Task 10: Final Verification And PR

**Files:**
- Backend and frontend changed files.

- [ ] **Step 1: Backend verification**

Run in `C:\Codes\cicd-ex\cicd-workflow-be`:

```powershell
npm test -- --runInBand env-provisioning capabilities projects/projects.repository.spec.ts
npm run build
npx eslint src/modules/env-provisioning src/modules/capabilities src/config/app.config.ts src/common/config/env.validation.ts src/app.module.ts src/modules/projects/projects.repository.ts
git diff --check
```

Expected:

- Jest focused suites pass.
- Build exits 0.
- ESLint exits 0 for changed backend files.
- Diff check exits 0.

- [ ] **Step 2: Frontend verification**

Run in `C:\Codes\cicd-ex\cicd-workflow-fe`:

```powershell
npm test -- --coverage=false tests/unit/env-provisioning-api.test.ts tests/unit/deployment-providers-section.test.tsx tests/unit/project-env-panel.test.tsx
npm run lint
npm run build
git diff --check
```

Expected:

- Focused frontend tests pass.
- Lint exits 0 or only reports known unrelated warnings.
- Build exits 0.
- Diff check exits 0.

- [ ] **Step 3: Push and open PRs to test**

Run in each changed repo:

```powershell
git push
gh pr create --base test --head env-provisioning --draft --fill
```

Expected: PRs are created or existing PRs are updated for `env-provisioning -> test`.

## Spec Coverage Self-Review

- Feature flag: Task 1 and Task 6.
- Backend schema: Task 2.
- Encrypted provider tokens: Task 3 and Task 6.
- Write-only app env values: Task 4 and Task 6.
- Render and Vercel provider clients: Task 5.
- Provider target creation before env submission: Task 5, Task 6, Task 9.
- Provider connection UI: Task 8.
- Project env provisioning UI: Task 9.
- Test/UAT/production support: Task 5, Task 6, Task 9.
- BYO and FlowCI-managed modes: Task 4, Task 5, Task 6.
- Overwrite existing provider values: Task 5.
- Final verification: Task 10.
