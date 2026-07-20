# Full Platform Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` to expand any single phase into task-level implementation steps before code changes. Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute those steps. Each phase below must be independently shippable.

**Goal:** Turn FlowCI from a project/workflow generator into a full project control plane for tracking, customization, deployment management, drift repair, CI/CD visibility, usage controls, team access, audit, and notifications.

**Architecture:** Keep the current project creation, workflow generation, CI auth, deployment provisioning, and env provisioning systems as the foundation. Add dashboard-facing aggregate APIs and narrow service modules around project state, workflow settings, sync snapshots, drift checks, CI run reads, deployment history, usage counters, audit events, and notifications. Defer new third-party API dependencies by building provider adapter interfaces, local/mock adapters, stored snapshots, and capability-gated activation first. Prefer read-only sync and PR-based changes first; mutate GitHub, Render, Vercel, or secrets only through explicit user actions.

**Tech Stack:** NestJS, Supabase/Postgres, provider adapter interfaces, local/mock provider adapters, GitHub REST/Actions APIs, Render API, Vercel API, Next.js/React, Jest, GitHub Actions reusable workflows.

---

## Current Implementation Baseline

Do not rebuild the existing foundation. New work should compose on top of these capabilities.

| Area | Current Capability | Main Code/Docs |
| --- | --- | --- |
| Project creation | Creates GitHub repos, branch structure, starter files, workflow bundle, project DB row | `src/modules/projects/projects.service.ts`, `src/modules/projects/projects.repository.ts` |
| Existing repo setup | Discovers an existing repo and opens a setup PR | `src/modules/existing-repos/*`, FE existing repo setup UI |
| Workflow bundle | Generates Access Gate, Quality, Package staged workflow files | `src/modules/workflows/staged-workflow.builder.ts` |
| Backend CI gate | Issues/validates per-project CI token for workflow runtime auth | `src/modules/ci/*`, `supabase/migrations/20260607_project_ci_tokens.sql` |
| Project list | Shows provisioned projects and basic project detail in Current Projects | `src/modules/projects/projects.controller.ts`, `src/components/product/workflow-current-tab.tsx` |
| Workflow history | Stores generated workflow history and allows YAML copy/download | `src/modules/workflows/*`, Current Projects history tab |
| Provider connections | Saves BYO Render/Vercel connections encrypted, lists/revokes metadata | `src/modules/env-provisioning/provider-connections*` |
| Deployment targets | Creates/registers Render/Vercel targets linked to a project | `src/modules/env-provisioning/deployment-targets*` |
| Env vars | Pushes write-only env values to provider and stores metadata only | `src/modules/env-provisioning/env-vars*`, `src/components/product/project-env-panel.tsx` |
| Managed Vercel | Creates Vercel projects without requiring Vercel GitHub integration, installs CI secrets | `vercel-ci-secrets.service.ts`, deployment provisioning docs |
| Managed Render | Creates image-backed Render services, installs CI secrets, uses central image deploy workflow | `render-ci-secrets.service.ts`, `render-env.client.ts`, central `render-deploy.yml` |
| Basic result UI | Shows generated workflow files and provisioning result metadata | `src/components/product/setup-result-panel.tsx` |
| Feature flag | Env provisioning can be disabled through backend capabilities | `ENV_PROVISIONING_ENABLED`, `src/modules/capabilities/*` |

### Partially Added

| Area | Present | Missing |
| --- | --- | --- |
| Project sync | `POST /projects/sync` checks GitHub repo existence | Deep sync for workflow files, GitHub secrets, CI token, provider target, env drift |
| Project detail | Basic current project panel | Dedicated dashboard detail page with tabs, health, targets, runs, deployments, settings |
| Deployment tracking | Target metadata is stored | Provider deployment history, active deployment, status polling |
| CI visibility | Links to GitHub Actions | In-app run list, stage status, failure summaries, retry action |
| Customization | Creation-time workflow options | Post-create settings edit, workflow diff preview, regenerate/update PR |
| Repair | Can create targets and provision env vars | Repair workflow files, reinstall secrets, rotate CI token, reconnect provider, detach missing target |
| Usage/cost | Render cost guard config exists | Product-facing quotas, usage counters, managed resource exposure view |
| Audit | Some timestamps/statuses exist | Dedicated audit event stream |
| Notifications | None beyond UI messages | In-app notification center and later email/webhooks |

---

## Product Principles

1. **Project state is long-lived.** A FlowCI project should be managed after creation, not just created once.
2. **PR-first customization.** Workflow and repo changes should create GitHub PRs by default. Direct branch mutation is reserved for explicit admin/advanced actions.
3. **Write-only secrets.** Runtime env values remain write-only. FlowCI stores metadata, not secret values.
4. **Sync before repair.** The dashboard should detect drift before offering destructive or mutating repair actions.
5. **Provider abstraction, provider honesty.** Render and Vercel should share UI concepts where possible, but provider-specific limits and errors must be shown clearly.
6. **Phased dashboard, not one massive release.** Each phase must ship independently and be useful on its own.

---

## Phase Independence Contract

Every phase must be safe to commit, push, deploy, and leave running even if no later phase is implemented.

### Required Rules For Every Phase

- **Backward-compatible migrations only.** Add new schemas, tables, columns, indexes, views, and nullable fields. Do not drop or rename existing objects in the same phase unless a compatibility bridge keeps old code working.
- **Backward-compatible APIs only.** Add endpoints or response fields. Do not remove existing response fields. When a new field cannot be computed, return `null`, `[]`, or a capability flag instead of failing the request.
- **Feature flags for risky or mutating behavior.** New provider-write actions, GitHub-write actions, and quota enforcement must be guarded by backend capabilities until production evidence exists.
- **Third-party APIs are deferred by default.** New phases must not require live GitHub, Render, or Vercel API access unless that phase is explicitly the third-party activation phase. Earlier phases should use stored project data, mock adapters, fixture-backed responses, or disabled capability states.
- **Adapter contracts before live clients.** If a feature eventually needs a provider API, define the internal interface and test it with a local adapter first. Add the real client later behind a provider-specific flag.
- **Read-only before write.** A phase may expose read-only state before adding repair or mutation. A write phase must not be required for the read phase to work.
- **Provider failures degrade gracefully.** Missing Render, Vercel, or GitHub credentials must show disabled states and clear messages, not break project pages.
- **Secrets remain write-only.** No phase may store or display secret values after submission.
- **Old projects must render.** Projects created before deployment provisioning, workflow bundles, or env metadata must still open with empty-state copy and no server error.
- **Each phase includes rollback.** Rollback means disabling new UI/API through capability flags or reverting that phase without corrupting existing project data.
- **Each phase has a commit checkpoint.** After acceptance tests pass, commit and push the phase before starting the next one.

### Phase Compatibility Table

| Phase | Ships Alone If | Does Not Require |
| --- | --- | --- |
| 1. Project Control Center Read Model | Project page renders from existing stored data with empty states | live provider sync, drift repair, CI run ingestion |
| 2. Manual Sync Snapshot | Sync writes a cached health snapshot from stored data and local adapters | live GitHub, Render, or Vercel API access |
| 3. Workflow Settings Preview | User can preview workflow changes without writing to GitHub | PR creation, direct apply |
| 4. Workflow Update PR | User can open a GitHub PR for workflow changes | drift detection, CI tracking |
| 5. Deployment Target Management | User can view/edit metadata and see disabled provider-write actions | live provider write access, deployment history |
| 6. Env Manager Upgrade | User can bulk validate/provision/delete metadata safely | audit events, notifications |
| 7. CI Runtime Tracking Contract | User can view stored/mock CI run status and GitHub links | live GitHub Actions API access |
| 8. Deployment History Contract | User can view stored/mock deployment history and provider links | live Render or Vercel deployment APIs |
| 9. Drift Detection Read-Only | User can see findings from stored data/local adapters | live provider checks, repair actions |
| 10. Repair Actions Contract | User can run local-safe repairs and see disabled provider repairs | live provider mutation |
| 11. Usage And Quotas | Managed resource limits are visible/enforced from local counters | workspaces, audit notifications |
| 12. Teams, Audit, Notifications | Collaboration and event visibility work on top of existing project actions | live provider integrations |
| 13. Third-Party API Activation | Live GitHub/Render/Vercel clients can replace mock adapters per flag | new dashboard UI foundations |

---

## Target Feature Map

### 1. Project Control Center

- Project header with repo, service name, project type, repo shape, current status, latest workflow commit, and workflow bundle stage count.
- Health summary for GitHub repo, workflow files, CI token, GitHub Actions secrets, provider targets, env metadata, and subscription gate.
- Quick actions for repo, GitHub Actions, provider dashboard, sync, repair, secret reinstall, CI token rotation, env vars, and workflow settings.
- Tabs: Overview, Workflow, Deployments, Environment, Activity, Settings.

### 2. Workflow Customization

- Editable workflow recipe, central workflow ref/tag, Node version, package manager, root directory, coverage threshold, and check toggles.
- Preview generated workflow bundle before writing.
- Create update PR by default.
- Preserve staged workflow file names unless the user explicitly changes recipe.

### 3. Deployment Management

- List Render and Vercel targets per project.
- Show slot, provider, ownership mode, strategy, provider IDs, branch, root directory, commands, installed secret names, and sync status.
- Manage target metadata, sync target, reinstall secrets, detach target, and open provider dashboard.

### 4. Environment And Secret Provisioning

- Keep existing provider provisioning.
- Add bulk `.env` parsing, metadata filters, delete key support, re-provision selected keys, and env templates.
- Continue storing metadata only.

### 5. CI/CD Runtime Tracking

- Show GitHub Actions run list per project.
- Map runs to stages: Access Gate, Quality, Package, Deploy Render, Deploy Vercel.
- Show failure categories and GitHub log links.

### 6. Deployment History

- Show Vercel deployment URL/status/environment/branch/commit.
- Show Render deploy ID/status/image URL/commit when available.
- Normalize statuses across providers.

### 7. Drift Detection And Repair

- Detect missing repo, branch, workflow files, CI token, CI secrets, provider target, provider connection, and tracked env keys where provider APIs allow.
- Repair only after detection and explicit user confirmation.

### 8. Usage, Quotas, And Cost Tracking

- Track projects, managed Render services, managed Vercel projects, BYO targets, env keys, workflow PRs, CI validations, and deployment targets.
- Enforce plan limits before cost-sensitive actions.

### 9. Teams, Roles, Access, Audit, Notifications

- Add workspaces, members, roles, audit events, and in-app notifications.
- Preserve current personal project access during migration.

---

## Recommended Shippable Phases

## Phase 1: Project Control Center Read Model

### Scope

Build a project detail API and UI using data FlowCI already stores. This phase is read-only except for existing env provisioning actions already present in the app.

### Backend

- Add `GET /api/v1/projects/:id/overview`.
- Aggregate existing data only:
  - project row
  - `project_options.workflowFiles`
  - deployment target rows
  - env var metadata rows
  - CI token active/revoked status
  - existing workflow history rows when available
- Return stable sections:
  - `project`
  - `workflow`
  - `deploymentTargets`
  - `environment`
  - `ciAuth`
  - `health`
  - `capabilities`
- Avoid required migration unless the current repository layer cannot query one of the existing tables cleanly.

### Frontend

- Add a dedicated project detail layout with tabs:
  - Overview
  - Workflow
  - Deployments
  - Environment
  - Activity
  - Settings
- Activity tab shows `No activity events yet`.
- Settings tab shows read-only project metadata.
- Environment tab reuses the existing env provisioning panel.
- Old projects without workflow files or targets show `Not configured`.

### Tests

- Backend controller test:
  - returns `200` for an owned project
  - returns empty arrays for projects without targets/env metadata
  - returns `404` or existing ownership error for inaccessible projects
- Backend service test:
  - aggregates workflow files from current `project_options`
  - marks CI token active/revoked correctly
- Frontend test:
  - renders all tabs
  - renders empty states
  - preserves existing env provisioning panel behavior

### Rollback

- Hide the project detail route or tab entry.
- Keep `GET /overview` deployed if already harmless, because it only reads existing data.
- No data cleanup required.

### Commit Checkpoint

Commit message: `feat: add project control center overview`

### Acceptance Criteria

- A user can open any project and see repo, workflow, target, env, and CI auth state in one place.
- Existing project creation and env provisioning still work.
- No provider API credentials are required for the page to load.

---

## Phase 2: Manual Sync Snapshot

### Scope

Add an explicit sync action that checks FlowCI's stored project state and local/mock adapter state, then stores a cached health snapshot. This phase intentionally does not check live GitHub, Render, or Vercel state so automated testing and test deployment do not require provider credentials. The project page must still work if sync has never run.

### Third-Party API Deferral Contract

- Do not call GitHub, GitHub Actions, Render, Vercel, provider secret, or provider deployment APIs in this phase.
- Do not reuse `POST /api/v1/projects/sync` internals if they make live GitHub API calls.
- If an external check is needed later, define an adapter interface now and bind it to a local implementation that reads stored DB rows only.
- The UI must label this state as `Local snapshot` so users do not confuse it with verified live provider state.
- Manual live provider testing belongs to Phase 13, after the local dashboard contracts are stable.

### Feature Flag

- `PROJECT_SYNC_SNAPSHOTS_ENABLED=true`
- If false, hide the sync button and return current Phase 1 overview data.

### Migration

- Add `project_dashboard_snapshots` in the same schema pattern used by project/deployment metadata.
- Suggested columns:
  - `id`
  - `project_id`
  - `status`
  - `summary_json`
  - `findings_json`
  - `started_at`
  - `completed_at`
  - `created_by`
  - `created_at`
- Add indexes on `project_id` and `created_at`.

### Backend

- Add `POST /api/v1/projects/:id/sync`.
- Keep this endpoint independent from existing GitHub-backed project sync logic.
- Check only local/stored read paths in this phase:
  - project row exists
  - workflow file metadata exists in `project_options.workflowFiles`
  - deployment targets have provider IDs or show `not_provisioned`
  - CI token exists and is not revoked
  - env metadata exists by target/environment
- Produce findings from stored data only:
  - `workflow_files_missing`
  - `deployment_target_not_provisioned`
  - `ci_token_missing`
  - `ci_token_revoked`
  - `env_metadata_empty`
- Add adapter interfaces for future live checks, but bind them to local/mock implementations:
  - `GithubProjectStateAdapter`
  - `DeploymentProviderStateAdapter`
  - `CiAuthStateAdapter`
- Add unit tests that fail if the sync path calls the existing `GithubService`, Render clients, or Vercel clients.

### Frontend

- Add `Sync now` button on Overview.
- Show last sync time, last sync status, and findings count.
- If no snapshot exists, show `Not synced yet`.
- If live provider sync is disabled, show `Local snapshot`.

### Tests

- Migration validation by parsing/inspecting the SQL file locally; do not require a live Supabase push for this phase's automated test.
- Backend tests:
  - creates snapshot for successful sync
  - creates snapshot without provider credentials
  - does not fail old project overview when no snapshot exists
  - verifies mock adapters are used instead of live provider clients
  - verifies no GitHub, Render, or Vercel client method is called during sync
- Frontend tests:
  - sync disabled when capability false
  - empty state before first sync
  - last sync state after API response
  - renders `Local snapshot` for Phase 2 sync data

### Rollback

- Set `PROJECT_SYNC_SNAPSHOTS_ENABLED=false`.
- Leave table in place.
- Existing Phase 1 page continues to work from base project data.

### Commit Checkpoint

Commit message: `feat: add project sync snapshots`

### Acceptance Criteria

- Sync can be run manually and safely.
- Snapshot storage is additive.
- Project detail works before and after sync.
- No third-party credentials are needed to test this phase.
- Any live-provider truth check is visibly deferred and does not block this phase.

---

## Phase 3: Workflow Settings Preview

### Scope

Let users edit workflow settings locally in the UI and preview regenerated workflow files without writing to GitHub.

### Feature Flag

- `WORKFLOW_SETTINGS_PREVIEW_ENABLED=true`
- If false, Workflow tab remains read-only.

### Migration

- Add `project_workflow_settings`.
- Backfill lazily in code from existing `project_options` when no settings row exists.
- Store normalized settings, not generated YAML blobs as the source of truth.

### Backend

- Add `GET /api/v1/projects/:id/workflow-settings`.
- Add `POST /api/v1/projects/:id/workflow-settings/preview`.
- Preview returns normalized settings, generated workflow files, diff summary, and validation warnings.

### Frontend

- Add Workflow Settings form:
  - recipe
  - central workflow ref/tag
  - Node version
  - package manager
  - service path/root directory
  - test/lint/build/security toggles
  - coverage threshold
  - deploy target mappings
- Add Preview panel with generated file names and changed/unchanged badges.
- Disable save/apply controls in this phase except `Preview`.

### Tests

- Backend tests:
  - maps old `project_options` into settings
  - preview generates the same three staged workflow files
  - invalid coverage threshold returns validation error
- Frontend tests:
  - loads settings from API
  - preview button displays generated files
  - no GitHub write action is shown when PR feature flag is false

### Rollback

- Set `WORKFLOW_SETTINGS_PREVIEW_ENABLED=false`.
- Keep settings table; it does not affect workflow runtime.

### Commit Checkpoint

Commit message: `feat: add workflow settings preview`

### Acceptance Criteria

- Users can see what would change before GitHub writes exist.
- Existing project creation still uses the current workflow generator.
- No branch, repo, or PR is created in this phase.

---

## Phase 4: Workflow Update PR

### Scope

Create GitHub PRs for workflow setting changes. This phase turns Phase 3 preview into a safe write flow.

### Feature Flag

- `WORKFLOW_UPDATE_PR_ENABLED=true`
- If false, keep preview-only behavior.

### Backend

- Add `POST /api/v1/projects/:id/workflow-settings/pr`.
- Use existing GitHub branch/file/PR creation patterns.
- Branch naming: `flowci/workflow-update-<YYYYMMDDHHmmss>`.
- PR title: `Update FlowCI workflow configuration`.
- PR body includes changed settings summary, generated workflow file list, and a note that runtime env values are not included.
- Persist request metadata in `project_workflow_update_requests`.

### Frontend

- Add `Create update PR` action after a successful preview.
- Show PR URL and status.
- Do not offer direct apply.

### Tests

- Backend tests:
  - creates branch and writes all staged workflow files
  - preserves `workflowPath` backward compatibility
  - stores PR metadata
  - handles GitHub 422 with a clean user message
- Frontend tests:
  - PR button appears only when capability true
  - success response shows PR link
  - GitHub error shows clean copy

### Rollback

- Set `WORKFLOW_UPDATE_PR_ENABLED=false`.
- Existing PRs remain on GitHub and are harmless.
- Preview phase remains available.

### Commit Checkpoint

Commit message: `feat: create workflow update pull requests`

### Acceptance Criteria

- Workflow changes happen through PRs only.
- Staged workflow file structure and backend CI auth gate remain intact.
- Failed PR creation does not mark settings as applied.

---

## Phase 5: Deployment Target Management

### Scope

Manage existing Render/Vercel deployment target metadata after project creation. Keep live provider-write actions deferred and disabled until the third-party activation phase.

### Feature Flag

- `PROJECT_TARGET_MANAGEMENT_ENABLED=true`
- Existing `ENV_PROVISIONING_ENABLED` remains the umbrella flag for env/provider capabilities.

### Backend

- Add `PATCH /api/v1/projects/:projectId/deployment-targets/:targetId`.
- Add `POST /api/v1/projects/:projectId/deployment-targets/:targetId/sync`.
- Add `DELETE /api/v1/projects/:projectId/deployment-targets/:targetId`.
- Add `GET /api/v1/projects/:projectId/deployment-targets/:targetId/actions` to report which provider actions are disabled until live integration is enabled.
- Editing FlowCI metadata does not automatically mutate provider settings.
- In this phase, `sync` reads stored metadata and local adapter state only.
- Do not call Render, Vercel, or GitHub secret APIs.

### Frontend

- Add deployment target detail cards.
- Add edit drawer:
  - display name
  - branch
  - root directory
  - build/start command
  - service slot
  - provider environment
- Add actions:
  - sync target
  - reinstall deployment secrets disabled with `Provider activation required`
  - detach from FlowCI
  - open provider dashboard

### Tests

- Backend tests:
  - update target metadata
  - reject update for another user's target
  - detach target without deleting provider resource
  - provider-write actions are disabled when live integration is off
- Frontend tests:
  - renders Vercel and Render target cards
  - edit drawer preserves current values
  - detach confirmation is required

### Rollback

- Set `PROJECT_TARGET_MANAGEMENT_ENABLED=false`.
- Existing targets remain usable for workflow/deploy.
- Metadata edits made before rollback remain stored but no UI write controls are shown.

### Commit Checkpoint

Commit message: `feat: manage project deployment targets`

### Acceptance Criteria

- Users can inspect and edit FlowCI target metadata after creation.
- Provider-write actions are visible but disabled with clear copy.
- Detaching a target does not delete the Render/Vercel resource.
- No provider credentials are required for tests.

---

## Phase 6: Environment Manager Upgrade

### Scope

Improve env var provisioning into a full write-only environment manager.

### Feature Flag

- Continue using `ENV_PROVISIONING_ENABLED=true`.
- Add optional capability field `envBulkProvisioning` if the frontend needs separate gating.

### Migration

- Add nullable metadata fields if missing:
  - `environment`
  - `target_id`
  - `last_provisioned_by`
  - `last_error_summary`
  - `removed_at`
- Do not add secret value columns.

### Backend

- Add `POST /api/v1/projects/:projectId/env-vars/validate`.
- Add `DELETE /api/v1/projects/:projectId/env-vars/:metadataId`.
- Validation accepts `.env` text and returns key count, duplicate keys, invalid keys, and provider target compatibility warnings.
- Delete removes the key from provider when supported, then marks metadata removed.

### Frontend

- Add bulk paste `.env` parser UI.
- Show parsed keys only, never values after parse.
- Add filters by target, environment, and status.
- Add delete action with confirmation.
- Add re-provision selected keys requiring value re-entry.

### Tests

- Backend tests:
  - parses `.env` text without storing values
  - detects duplicates
  - deletes Vercel env metadata and provider key
  - deletes Render env metadata and provider key where API support exists
- Frontend tests:
  - parsed values are cleared after submit
  - filters work
  - delete requires confirmation

### Rollback

- Disable env feature with `ENV_PROVISIONING_ENABLED=false`.
- Leave metadata columns in place.
- Existing provider env vars remain with providers.

### Commit Checkpoint

Commit message: `feat: improve project environment management`

### Acceptance Criteria

- Users can bulk add and manage env key metadata.
- Secret values are never recoverable in FlowCI.
- Existing env provisioning still works.

---

## Phase 7: CI Runtime Tracking Contract

### Scope

Build the CI run API/UI contract without requiring live GitHub Actions API access. Use stored workflow metadata, generated fixture data in local/dev, and GitHub links as the real escape hatch.

### Feature Flag

- `CI_RUN_TRACKING_ENABLED=true`
- `CI_RUN_LIVE_GITHUB_ENABLED=false`

### Backend

- Add `GET /api/v1/projects/:id/ci-runs`.
- Add `GET /api/v1/projects/:id/ci-runs/:runId`.
- Add `POST /api/v1/projects/:id/ci-runs/:runId/rerun` as a disabled action unless live GitHub is enabled.
- Add `CiRunsProvider` interface.
- Bind default implementation to `LocalCiRunsProvider`.
- `LocalCiRunsProvider` returns:
  - empty list for production unless seeded data exists
  - fixture runs for local/mock mode
  - GitHub Actions URL derived from repo metadata
- Map workflow names to stages:
  - Access Gate
  - Quality
  - Package
  - Deploy Render
  - Deploy Vercel
- Do not call GitHub Actions API in this phase.

### Frontend

- Add Runs tab.
- Show stage, branch, commit, actor, status, conclusion, timestamps, and GitHub run link.
- Add rerun button for failed runs only when `canRerun` is true.
- Show `Live GitHub run sync is not enabled` when data is local/mock.

### Tests

- Backend tests:
  - maps workflow names to stages
  - handles empty run list
  - returns fixture runs in mock mode
  - rerun returns disabled capability when live GitHub is off
- Frontend tests:
  - renders empty state
  - renders failed run with GitHub link
  - hides rerun when capability false

### Rollback

- Set `CI_RUN_TRACKING_ENABLED=false`.
- Runs tab shows GitHub Actions link only.
- No data cleanup required.

### Commit Checkpoint

Commit message: `feat: show project ci runs`

### Acceptance Criteria

- Users can understand latest CI state without leaving FlowCI.
- GitHub links remain available for logs.
- No database dependency is introduced for run tracking.
- No GitHub token is required for tests.

---

## Phase 8: Deployment History Contract

### Scope

Build the deployment history API/UI contract without requiring live Render or Vercel deployment API access. Use stored target metadata, optional local fixtures, and provider dashboard links.

### Feature Flag

- `DEPLOYMENT_HISTORY_ENABLED=true`
- `DEPLOYMENT_HISTORY_LIVE_PROVIDERS_ENABLED=false`

### Backend

- Add `GET /api/v1/projects/:id/deployments`.
- Add `DeploymentHistoryProvider` interface.
- Bind default implementation to `LocalDeploymentHistoryProvider`.
- `LocalDeploymentHistoryProvider` returns:
  - empty list for production unless seeded data exists
  - fixture deployments for local/mock mode
  - provider dashboard URLs from stored target metadata
- Normalize statuses:
  - `queued`
  - `building`
  - `ready`
  - `failed`
  - `canceled`
  - `unknown`
- Do not call Render or Vercel deployment APIs in this phase.
- Live provider status returns disabled entries until Phase 13.

### Frontend

- Add Deployments tab.
- Show active deployment per target when fixture/stored data exists.
- Show history table with target, provider, environment, branch/commit if available, status, created/ready time, and provider link.
- Show `Live deployment sync is not enabled` when history is local/mock.

### Tests

- Backend tests:
  - normalizes stored Vercel-like statuses
  - normalizes stored Render-like statuses
  - handles no provider credentials
  - verifies live provider clients are not called
- Frontend tests:
  - renders mixed Render/Vercel deployments
  - renders disabled target message
  - links to provider dashboard/deployment

### Rollback

- Set `DEPLOYMENT_HISTORY_ENABLED=false`.
- Deployments tab falls back to target list from Phase 5.
- No persisted deployment data needs cleanup.

### Commit Checkpoint

Commit message: `feat: show provider deployment history`

### Acceptance Criteria

- Users can see current deployment state for Render and Vercel targets.
- Provider outages or missing credentials do not break the project page.
- No Render or Vercel token is required for tests.

---

## Phase 9: Drift Detection Read-Only

### Scope

Detect mismatch inside FlowCI's stored project state and local/mock provider adapter state. Do not repair anything in this phase and do not call live third-party APIs.

### Feature Flag

- `DRIFT_DETECTION_ENABLED=true`

### Migration

- Add `project_sync_findings`.
- Suggested columns:
  - `id`
  - `project_id`
  - `target_id`
  - `source`
  - `severity`
  - `code`
  - `message`
  - `details_json`
  - `status`
  - `detected_at`
  - `resolved_at`

### Backend

- Add `GET /api/v1/projects/:id/drift`.
- Add `POST /api/v1/projects/:id/drift/run`.
- Checks using stored/local state:
  - project repo metadata missing
  - branch metadata missing
  - workflow file metadata missing
  - workflow files differ from expected generated bundle when stored YAML/history exists
  - central workflow ref outdated
  - CI token missing/revoked
  - deployment target metadata missing required provider IDs
  - provider connection metadata unavailable
  - tracked env key metadata missing or failed
- Add finding codes for future live checks, but keep them inactive until Phase 13:
  - `github_repo_unreachable`
  - `github_secret_missing`
  - `provider_target_missing_live`
  - `provider_env_key_missing_live`
- Store findings with stable `code` values.

### Frontend

- Add Health/Findings panel.
- Show severity, source, message, and recommended next step.
- Repair buttons are disabled with `Repair actions coming in the next phase`.

### Tests

- Backend tests:
  - produces stable finding codes
  - deduplicates repeated findings
  - marks resolved findings when later sync passes
  - handles provider auth failure as a finding
- Frontend tests:
  - renders warning/error/info findings
  - no repair action is callable

### Rollback

- Set `DRIFT_DETECTION_ENABLED=false`.
- Keep findings table for future use.
- Phase 2 sync snapshots still work without detailed findings.

### Commit Checkpoint

Commit message: `feat: detect project drift`

### Acceptance Criteria

- Users can see what is wrong before FlowCI offers repair.
- Drift detection does not call or mutate GitHub, Render, Vercel, or env vars.

---

## Phase 10: Repair Actions Contract

### Scope

Add explicit repair actions for local-safe findings. Provider and GitHub repairs remain disabled until the third-party activation phase.

### Feature Flag

- `DRIFT_REPAIR_ENABLED=true`

### Backend

- Add `POST /api/v1/projects/:id/drift/:findingId/repair`.
- Supported local-safe repairs:
  - regenerate workflow preview
  - create workflow update PR only if `WORKFLOW_UPDATE_PR_ENABLED=true`
  - rotate CI token in FlowCI DB without installing it to GitHub unless live GitHub is enabled
  - detach missing target from FlowCI
  - mark stale metadata as ignored/resolved
- Disabled until Phase 13:
  - reinstall CI token secret in GitHub
  - reinstall Vercel deployment secrets
  - reinstall Render deployment secrets
  - update FlowCI metadata from live provider state
- Each repair must require ownership/authorization, validate finding is still active, write a result object, and never expose secret values.

### Frontend

- Enable repair buttons only for supported finding codes.
- Show confirmation modal explaining exact action.
- Show disabled provider repairs with `Live provider activation required`.
- Show success/failure result and prompt user to re-run drift detection.

### Tests

- Backend tests:
  - rejects repair for inactive finding
  - calls correct local repair service per finding code
  - rotates CI token without returning token value in response or installing GitHub secret
  - detaches target without deleting provider resource
- Frontend tests:
  - confirmation required
  - unsupported findings show no action
  - success result triggers refresh prompt

### Rollback

- Set `DRIFT_REPAIR_ENABLED=false`.
- Read-only drift findings remain available.
- Any repair already completed remains valid.

### Commit Checkpoint

Commit message: `feat: repair project drift findings`

### Acceptance Criteria

- Repairs are targeted and explicit.
- Unsupported findings remain read-only.
- No repair runs automatically.
- No live third-party API is needed for tests.

---

## Phase 11: Usage, Quotas, And Cost Controls

### Scope

Expose managed resource usage and enforce plan limits around cost-sensitive actions.

### Feature Flag

- `USAGE_QUOTAS_ENABLED=true`
- If false, show no quota blocks and keep existing subscription checks.

### Migration

- Add usage schema tables following existing schema separation:
  - `usage.plan_limits`
  - `usage.project_usage_counters`
  - optional `usage.usage_events`

### Backend

- Add `GET /api/v1/usage/me`.
- Add quota checks before:
  - project creation
  - managed Render target creation
  - managed Vercel target creation
  - env var key creation
  - workflow update PR creation
- Error response must include `limitCode`, `current`, `limit`, and `upgradeRequired`.

### Frontend

- Add usage panel under account/settings.
- Show usage near creation flows before submit.
- Render quota errors as clear upgrade/action messages.

### Tests

- Backend tests:
  - returns usage for user
  - blocks managed Render creation over limit
  - blocks managed Vercel creation over limit
  - allows BYO target if plan permits BYO separately
- Frontend tests:
  - renders usage meters
  - blocks submit or shows API quota message clearly

### Rollback

- Set `USAGE_QUOTAS_ENABLED=false`.
- Leave usage tables in place.
- Existing subscription gates continue to protect paid features.

### Commit Checkpoint

Commit message: `feat: add usage quotas`

### Acceptance Criteria

- Managed infrastructure cost is bounded.
- Users can see why an action is blocked.
- Quotas do not break existing subscription validation.

---

## Phase 12: Teams, Audit, Notifications

### Scope

Add collaboration, traceability, and operational notifications. This phase can ship after the personal-project dashboard is stable.

### Feature Flags

- `WORKSPACES_ENABLED=true`
- `AUDIT_EVENTS_ENABLED=true`
- `NOTIFICATIONS_ENABLED=true`

### Migration

- Add schemas/tables:
  - `orgs.workspaces`
  - `orgs.workspace_members`
  - optional `orgs.project_memberships`
  - `audit.audit_events`
  - `notifications.notifications`
  - `notifications.notification_preferences`
- Add nullable `workspace_id` to projects.
- Backfill one personal workspace per existing project owner.

### Backend

- Add workspace/member endpoints.
- Change project authorization to check workspace role when `workspace_id` exists.
- Keep backward compatibility for old user-owned projects during migration.
- Add audit writes for project creation, workflow PRs, CI token rotation, provider targets, provider secrets, env vars, provider connections, sync, repair, and quota blocks.
- Add in-app notifications for CI auth failure, workflow failure, provider disconnect, deployment failure, drift detection, and quota reached.

### Frontend

- Add workspace switcher.
- Add member management.
- Add Audit tab.
- Add notification center.
- Existing personal users see their default workspace automatically.

### Tests

- Backend tests:
  - backfilled personal workspace grants owner access
  - developer role cannot manage billing
  - viewer cannot mutate env vars
  - audit event is written for sensitive actions
  - notification is created for configured events
- Frontend tests:
  - workspace switcher renders personal workspace
  - role-based controls hide correctly
  - audit log renders events
  - notification center renders unread/read states

### Rollback

- Disable the three flags.
- Keep `workspace_id` nullable and keep old user ownership checks active.
- Audit/notification tables can remain unused.

### Commit Checkpoint

Commit message: `feat: add workspaces audit and notifications`

### Acceptance Criteria

- Existing single-user projects continue to work.
- Team roles protect project actions.
- Sensitive actions become traceable.
- Important failures surface in app.

---

## Phase 13: Third-Party API Activation

### Scope

Activate live GitHub, Render, and Vercel reads/writes behind provider-specific flags after the dashboard contracts are already working with local/mock adapters. This is the phase the user can test manually later with real credentials.

### Feature Flags

- `CI_RUN_LIVE_GITHUB_ENABLED=true`
- `DEPLOYMENT_HISTORY_LIVE_PROVIDERS_ENABLED=true`
- `PROJECT_SYNC_LIVE_GITHUB_ENABLED=true`
- `PROJECT_SYNC_LIVE_PROVIDERS_ENABLED=true`
- `DRIFT_LIVE_PROVIDER_CHECKS_ENABLED=true`
- `DRIFT_LIVE_REPAIR_ENABLED=true`

### Backend

- Implement live `GithubProjectStateAdapter`:
  - repo reachable
  - branch reachable
  - workflow files present
  - workflow file content hash/diff
  - GitHub Actions secret existence where API allows
- Implement live `CiRunsProvider`:
  - list workflow runs
  - fetch run detail
  - rerun failed run
- Implement live `DeploymentHistoryProvider`:
  - Vercel deployments by stored project/team metadata
  - Render deploys by stored service ID
- Implement live provider repair actions:
  - reinstall CI token secret in GitHub
  - reinstall Vercel deployment secrets
  - reinstall Render deployment secrets
  - update FlowCI metadata from live provider state
- Keep local/mock adapters as the default in test and local development.

### Frontend

- Replace `Local snapshot`, `Live GitHub run sync is not enabled`, and `Live deployment sync is not enabled` messages with live status when capability flags are true.
- Enable rerun and provider repair actions only when backend capabilities allow them.
- Keep disabled states for credentials or permissions that are missing.

### Tests

- Unit tests stay adapter-level and mock HTTP clients.
- Integration tests use provider fixtures, not real provider credentials.
- Manual smoke checklist with real credentials:
  - GitHub repo/workflow sync
  - GitHub Actions run list
  - GitHub rerun
  - Vercel deployment list
  - Render deployment list
  - CI token secret reinstall
  - Vercel deployment secret reinstall
  - Render deployment secret reinstall

### Rollback

- Turn off the live flags and the system falls back to local/mock adapters and disabled live actions.
- No schema rollback is required.
- Existing projects, workflow generation, env provisioning, and metadata views continue to work.

### Commit Checkpoint

Commit message: `feat: activate live provider adapters`

### Acceptance Criteria

- Real provider APIs are isolated behind adapter interfaces and flags.
- Local and automated tests do not require GitHub, Render, or Vercel credentials.
- Manual provider testing can be done later without blocking earlier phases.
- Disabling live flags returns the app to the stable local/mock behavior.

---

## Recommended First Implementation Boundary

Start with **Phase 1 only**.

Phase 1 is enough to ship a visible platform improvement because it converts the current project list into a project control center without adding new provider risk. It also creates the UI/API foundation for every later phase.

Do not combine Phase 1 with sync, workflow editing, CI run ingestion, deployment history, teams, or notifications. Those become cleaner once the project detail read model is stable.

---

## Open Decisions

1. Should workflow customization remain PR-only forever, or should direct apply exist later for owner/admin users behind an advanced flag?
2. Should env var deletion remove provider keys immediately, or first mark metadata as removed and queue provider deletion?
3. Should Phase 13 activate all providers together, or one provider at a time starting with the one easiest to manually smoke test?
4. Should team workspaces wait until personal dashboard phases 1-10 are complete?
5. Should quotas be configured internally first, or surfaced to users immediately as plan limits?
6. Should Render redeploy and Vercel redeploy be part of Phase 13, or a separate Phase 14 after live read-only provider checks are stable?

---

## Self-Review

- The revised plan no longer depends on a future phase for a current phase to function.
- Phase 1 is read-only and can be deployed without new migrations or provider credentials.
- Migrations are additive and rollback-safe.
- Mutating provider actions are capability-gated.
- Workflow changes stay PR-first.
- Drift detection and repair are split so detection can ship safely before mutation.
- CI and deployment history start as local/mock contracts to avoid third-party testing friction.
- Live GitHub, Render, and Vercel API activation is isolated in Phase 13.
- Teams are deferred until the personal project control plane is mature.
- Secrets remain write-only throughout all phases.
- Each phase has acceptance criteria, rollback notes, tests, and a commit checkpoint.
