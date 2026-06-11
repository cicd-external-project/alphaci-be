# Environment Provisioning Design

## Summary

FlowCI will add a feature-flagged environment provisioning system that lets users enter runtime environment variables in the website and push them automatically to Render or Vercel after a project is provisioned.

The first version supports both provider ownership modes:

- Bring-your-own provider: users save their own Render or Vercel provider connection.
- FlowCI-managed provider: FlowCI uses platform-owned Render or Vercel credentials.

Runtime env var values are write-only. FlowCI sends them to the selected provider and stores only non-secret metadata.

## Goals

- Provision runtime environment variables from the website to Render and Vercel.
- Create or select provider deployment targets before env vars are pushed.
- Support `test`, `uat`, and `production` environments.
- Support BYO and FlowCI-managed provider modes.
- Store BYO provider tokens encrypted for reuse.
- Never store app env var values after provisioning.
- Overwrite existing provider env var values when users submit the form.
- Hide and block the feature when `ENV_PROVISIONING_ENABLED` is disabled.

## Non-Goals

- Building a full encrypted app-secret vault.
- Letting users recover or view previously submitted env values.
- Provisioning GitHub Actions secrets for app runtime env vars. Vercel deploy
  credentials are an exception: FlowCI installs per-slot `VERCEL_*` repository
  secrets so generated workflows can deploy CI-pushed Vercel projects.
- Configuring custom domains, DNS, SSL policy, or rollback automation for newly created provider targets.
- Guaranteeing the first successful deployment after target creation; this feature creates provider targets and provisions env vars, while deployment execution remains handled by provider/GitHub workflows.
- Implementing per-secret rollback.

## Architecture

The backend adds an Env Provisioning module that owns feature gating, provider connections, deployment targets, provider API calls, and metadata persistence.

The frontend adds project-level environment variable screens after project setup. Users configure env vars only for already provisioned FlowCI projects, because those projects have enough GitHub metadata to create or select provider deployment targets.

Provider mapping:

- BYO mode: user chooses a saved Render or Vercel provider connection.
- FlowCI-managed backend projects: Render.
- FlowCI-managed frontend projects: Vercel.
- FlowCI-managed microservices: backend slot to Render and frontend slot to Vercel.

Data boundary:

- Stored encrypted: BYO Render/Vercel provider access tokens.
- Stored as metadata only: env key, provider, target, environment, status, last provisioned timestamp, and sanitized error summary.
- Never stored: app env var values such as database URLs, API keys, JWT secrets, or service credentials.

## Feature Flag

The backend is the source of truth.

```env
ENV_PROVISIONING_ENABLED=true
```

When disabled:

- Provider connection APIs reject access.
- Deployment target APIs reject access.
- Env provisioning APIs reject access.
- Backend capabilities report env provisioning as disabled.
- Frontend hides env provisioning entry points.

## Data Model

### `provider_connections`

Stores reusable BYO provider credentials.

```text
id
user_id
provider              render | vercel
label
encrypted_token
token_last_four
status                active | revoked | failed
created_at
updated_at
last_used_at
```

### `project_deployment_targets`

Links a FlowCI project to the provider resource that receives env vars.

```text
id
project_id
slot                  backend | frontend | standalone
ownership_mode        byo | flowci_managed
provider              render | vercel
provider_connection_id nullable
provider_project_id   Vercel project id or Render service id
provider_project_name
repo_full_name
branch_name
root_directory
build_command
start_command
environment_map       jsonb, maps test/uat/production to provider env names or ids
deployment_strategy   provider_native | vercel_git_connected | vercel_ci_pushed
provider_metadata     jsonb, provider ids, org/team ids, and generated secret names
status                active | missing | failed
created_at
updated_at
```

Current strategy mapping:

```text
vercel + flowci_managed => vercel_ci_pushed
vercel + byo            => vercel_ci_pushed
render + any ownership  => provider_native
```

`vercel_git_connected` is retained only for legacy records or a future advanced
mode. Normal provisioning should not select it.

### `project_env_var_metadata`

Stores only non-secret env var metadata.

```text
id
project_id
deployment_target_id
environment           test | uat | production
key
provider              render | vercel
value_stored          false
last_provisioned_at
last_provisioned_by
status                provisioned | failed
error_summary nullable
created_at
updated_at
```

## API Design

### Capabilities

```text
GET /api/v1/capabilities
```

Response shape:

```json
{
  "envProvisioning": {
    "enabled": true,
    "providers": ["render", "vercel"],
    "environments": ["test", "uat", "production"],
    "modes": ["byo", "flowci_managed"]
  }
}
```

### Provider Connections

```text
POST /api/v1/provider-connections
GET /api/v1/provider-connections
DELETE /api/v1/provider-connections/:id
```

Responsibilities:

- Create saved BYO Render/Vercel provider connections.
- Validate tokens before saving.
- Store tokens encrypted.
- List only non-secret connection metadata.
- Revoke connections without exposing token values.

### Deployment Targets

```text
GET /api/v1/projects/:projectId/deployment-targets
POST /api/v1/projects/:projectId/deployment-targets
```

Responsibilities:

- List provider targets attached to a project.
- Create new provider targets for provisioned FlowCI projects.
- Register BYO provider targets selected by the user when they already exist.
- Register FlowCI-managed provider targets selected or created by the platform.
- Persist environment mapping for `test`, `uat`, and `production`.

### Env Vars

```text
GET /api/v1/projects/:projectId/env-vars
POST /api/v1/projects/:projectId/env-vars/provision
```

Provision request:

```json
{
  "deploymentTargetId": "target-id",
  "environment": "test",
  "vars": [
    { "key": "DATABASE_URL", "value": "postgres://..." },
    { "key": "JWT_SECRET", "value": "..." }
  ]
}
```

Provision response:

```json
{
  "status": "completed",
  "provisioned": [
    { "key": "DATABASE_URL", "status": "provisioned" },
    { "key": "JWT_SECRET", "status": "provisioned" }
  ],
  "failed": []
}
```

Rules:

- Require session auth and active subscription.
- Require project ownership.
- Reject unsupported providers, target slots, and environments.
- Validate env var keys before provider calls.
- Send env values to provider and discard them.
- Store only key-level metadata and sanitized errors.
- Overwrite existing provider values.

## Provider Clients

Both providers implement a shared runtime env interface.

```ts
interface RuntimeEnvProviderClient {
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
    environment: "test" | "uat" | "production";
    vars: Array<{ key: string; value: string }>;
  }): Promise<ProvisionResult>;
}
```

### Render

Render targets are services.

FlowCI will:

- Validate Render tokens.
- List/select Render services for BYO mode.
- Create Render web services for backend and standalone backend targets.
- Use FlowCI-owned Render tokens for managed backend targets.
- Map FlowCI environments to Render service env vars or env groups.
- Read existing service env vars, merge submitted keys, then update the provider so unrelated keys are preserved.
- Overwrite submitted keys while preserving unrelated existing keys.

Render's service env-var update endpoint replaces the service env-var list. The provider client must therefore fetch current env vars first, merge the submitted key/value pairs into that list, and then submit the complete replacement payload. Environment group updates can use the single-key update endpoint when a target is backed by an env group.

Render target creation uses the provider create-service API. The first version creates web services from the GitHub repo and branch metadata FlowCI already knows. It stores the returned service id in `project_deployment_targets.provider_project_id`.

### Vercel

Vercel targets are projects.

FlowCI will:

- Validate Vercel tokens.
- List/select Vercel projects for BYO mode.
- Create Vercel projects for frontend and standalone frontend targets.
- Use FlowCI-owned Vercel tokens for managed frontend targets.
- Map FlowCI environments to Vercel environments.
- Upsert env vars with Vercel's project env API using `upsert=true`.
- Overwrite submitted keys while preserving unrelated existing keys.

Vercel environment mapping needs to be explicit because Vercel's native environment model does not perfectly match `test`, `uat`, and `production`. The first version stores the mapping in `project_deployment_targets.environment_map` and shows the mapping in the UI.

Vercel target creation uses the create-project API and links the project to the GitHub repo metadata FlowCI already knows. It stores the returned project id in `project_deployment_targets.provider_project_id`.

## Frontend UX

Env provisioning appears after project setup.

Primary entry points:

- Current Projects: each provisioned project gets an Environment Variables action.
- Project env screen or panel: configure provider target and env vars.
- Setup success panel: optional Configure env vars next-action button.

Main flow:

1. User opens a provisioned project.
2. User chooses provider mode and target behavior: create a new provider target or select an existing target.
3. FlowCI creates or registers the deployment target.
4. User chooses `test`, `uat`, or `production`.
5. User enters key/value rows.
6. User submits.
7. UI clears env values immediately after submit.
8. UI shows key-level provisioning status and metadata history.

Provider connection UI:

- Settings page gets a Deployment Providers section.
- User can add Render or Vercel tokens.
- Saved connections show provider, label, token suffix, status, and last used time.
- User can revoke a connection.

Metadata table example:

```text
DATABASE_URL          Render   test        provisioned   updated 2m ago
JWT_SECRET            Render   test        provisioned   updated 2m ago
NEXT_PUBLIC_API_URL   Vercel   production  failed        invalid target
```

Required UI copy:

- Values are sent directly to the provider and are not stored by FlowCI.
- Submitting a key overwrites the existing value in the selected provider environment.
- To change a value later, enter it again.

## Error Handling

Provisioning is per key.

- `completed`: all keys were provisioned.
- `partial`: some keys failed.
- `failed`: provider auth, target lookup, or provider API failure prevented provisioning.

Provider errors are sanitized before returning to the frontend. Backend logs must not include env values or provider token values.

## Security

- BYO provider tokens are encrypted at rest.
- App env var values are never stored or logged.
- All APIs require session auth.
- Project APIs require active subscription.
- Project ownership is checked before provider calls.
- Revoked provider connections cannot be used.
- Provider token suffix is safe to display; token body is never returned.

## Testing Plan

Backend unit tests:

- Feature flag disabled rejects provider/env APIs.
- Provider connection token encryption and decryption.
- Env values are not persisted.
- Project ownership guard rejects other users' projects.
- Overwrite behavior calls provider upsert/update path.
- Partial provider failures store metadata only.

Backend controller tests:

- Create, list, and revoke provider connections.
- List and create deployment targets.
- Provision env vars.
- Invalid project, environment, key, and provider cases.
- `401`, `402`, `403`, and disabled flag cases.

Provider client tests:

- Render token validation.
- Render env var upsert request shape.
- Vercel token validation.
- Vercel env var upsert request shape.
- Sanitized provider error mapping.

Frontend tests:

- Feature disabled hides UI.
- Provider connection form submits token and clears it.
- Env-var form submits values and clears them.
- Metadata table shows keys and statuses without values.
- Project action appears only for provisioned projects.

## Rollout Phases

### Phase 1: Backend Foundation

- Add feature flag and capabilities response.
- Add migrations.
- Add encryption service.
- Add provider connection APIs.
- Add metadata-only env var APIs.
- Add fake provider clients for tests.

### Phase 2: Provider Clients

- Add Render client.
- Add Vercel client.
- Add BYO token validation.
- Add FlowCI-managed token selection from backend env vars.

### Phase 3: Frontend

- Add capabilities fetch.
- Add provider connections UI in Settings.
- Add project env-var panel.
- Add metadata status table.

### Phase 4: Project Integration

- Add provider target creation for provisioned projects.
- Add deployment target metadata for created or selected targets.
- Add managed mapping for backend, frontend, and microservices projects.
- Add setup success Configure env vars action.

### Phase 5: Hardening

- Add audit log.
- Add sanitized logs.
- Add provider rate-limit handling.
- Add retry/re-provision action.
- Update docs and env examples.

## Open Assumptions

- The first version creates Render services and Vercel projects, but does not configure custom domains, DNS, or rollback automation.
- BYO provider tokens are encrypted and stored.
- App env values are write-only and not stored.
- Existing provider env values are overwritten.
- Backend `ENV_PROVISIONING_ENABLED` is the feature flag source of truth.
