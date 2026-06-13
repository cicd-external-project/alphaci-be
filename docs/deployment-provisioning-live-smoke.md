# Deployment Provisioning Live Smoke Test

Use this checklist only after explicit approval to create temporary external resources. The test creates a short-lived GitHub repository plus provider-side deployment targets, then verifies FlowCI can provision initial env vars and install CI deployment secrets.

## Preconditions

- Backend is running against the target Supabase database with the latest env-provisioning migrations applied.
- `ENV_PROVISIONING_ENABLED=true`.
- Managed provider credentials are configured:
  - `FLOWCI_RENDER_API_KEY`
  - `FLOWCI_RENDER_OWNER_ID`
  - `FLOWCI_RENDER_DEFAULT_REGION`
  - `FLOWCI_RENDER_DEFAULT_INSTANCE_TYPE=free`
  - `FLOWCI_RENDER_ALLOWED_INSTANCE_TYPES=free`
  - `FLOWCI_RENDER_ALLOW_PAID_MANAGED=false`
  - `FLOWCI_RENDER_MANAGED_MAX_SERVICES_PER_USER=2`
  - `FLOWCI_RENDER_BOOTSTRAP_IMAGE`
  - `FLOWCI_RENDER_REGISTRY_CREDENTIAL_ID` when Render needs explicit private registry credentials
  - `FLOWCI_VERCEL_TOKEN`
  - `FLOWCI_VERCEL_TEAM_ID`
  - `FLOWCI_VERCEL_TEAM_SLUG`
- GitHub App credentials are configured and the app can create repositories under the test owner.
- Test user has an active Pro subscription.
- The test name prefix is unique, for example `flowci-smoke-YYYYMMDD-HHMM`.

## Test Matrix

Run these scenarios in order:

1. Managed Vercel frontend target with CI-pushed deployment.
2. Managed Render backend target with image-pushed deployment.
3. BYO Render existing service attach, if a disposable existing service is available.

Do not run paid Render instance types during the smoke test.

## Managed Frontend + Backend Smoke

1. Sign in as the test user.
2. Create a new project with a unique name.
3. Enable deployment provisioning.
4. Configure frontend target:
   - slot: `frontend`
   - provider: `vercel`
   - ownership: `flowci_managed`
   - project name: `<prefix>-frontend`
   - branch: `test`
   - root directory: `frontend`
   - environment: `test`
5. Configure backend target:
   - slot: `backend`
   - provider: `render`
   - ownership: `flowci_managed`
   - deploy method: `managed_image`
   - project name: `<prefix>-backend`
   - branch: `test`
   - root directory: `backend`
   - Docker context: `backend`
   - Dockerfile path: `backend/Dockerfile`
   - service type: `web_service`
   - instance type: `free`
   - region: configured Render test region
   - environment: `test`
6. Add one harmless env var per target:
   - `FLOWCI_SMOKE_ID=<prefix>`
7. Submit project setup.
8. Confirm the setup response:
   - status is `completed`.
   - `workflowFiles` contains the Access Gate, Quality, and Package workflows.
   - Vercel target status is `created`.
   - Render target status is `created`.
   - Render target strategy is `render_image_pushed`.
9. Confirm GitHub repository secrets:
   - `VERCEL_FRONTEND_TOKEN`
   - `VERCEL_FRONTEND_ORG_ID`
   - `VERCEL_FRONTEND_PROJECT_ID`
   - `RENDER_BACKEND_API_KEY`
   - `RENDER_BACKEND_SERVICE_ID`
   - `RENDER_BACKEND_OWNER_ID`
   - `RENDER_BACKEND_REGISTRY_CREDENTIAL_ID` if configured
10. Confirm provider resources:
   - Vercel project exists in `FLOWCI_VERCEL_TEAM_ID`.
   - Render service exists in `FLOWCI_RENDER_OWNER_ID`.
   - Render service uses image-backed runtime and bootstrap image before the first CI deployment.
   - `FLOWCI_SMOKE_ID` exists in both providers.
11. Push or dispatch the generated package workflow on `test`.
12. Confirm GitHub Actions:
   - Access Gate succeeds.
   - Quality succeeds.
   - Package succeeds or reaches provider-specific deployment execution.
   - Render job builds and pushes GHCR image.
   - Render job calls `PATCH /v1/services/{serviceId}` and `POST /v1/services/{serviceId}/deploys`.

## BYO Existing Render Smoke

Only run this when a disposable existing Render service is available.

1. Connect a BYO Render provider connection.
2. Confirm the connection metadata includes the Render owner ID returned by `/v1/owners`.
3. Create a project deployment target with:
   - provider: `render`
   - ownership: `byo`
   - action: `register_existing`
   - deploy method: `existing_service`
   - service ID: disposable Render service ID
   - service name: disposable Render service name
4. Confirm GitHub secrets use the BYO Render token and owner ID:
   - `RENDER_BACKEND_API_KEY`
   - `RENDER_BACKEND_SERVICE_ID`
   - `RENDER_BACKEND_OWNER_ID`
5. Confirm no legacy `deployHookUrl` metadata is stored for the target.

## Cleanup

Run cleanup before ending the smoke test unless the owner explicitly asks to keep the resources.

1. Delete the temporary GitHub repository.
2. Delete the temporary Vercel project.
3. Delete the temporary Render service.
4. Revoke any temporary BYO provider connection.
5. Remove any test rows if they should not remain in Supabase:
   - project
   - deployment targets
   - env var metadata
   - provider connections
6. Confirm no active GitHub Actions secrets or provider resources remain with the smoke prefix.

## Evidence To Record

Capture these before cleanup:

- Project ID and repo full name.
- Generated workflow file list.
- Deployment provisioning result summary.
- Render service ID and owner ID.
- Vercel project ID and team ID.
- GitHub Actions run URL.
- Provider cleanup confirmation.
