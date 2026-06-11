# Deployment Provisioning

## Current Behavior

FlowCI can create provider deployment targets during project setup and push initial runtime env vars directly to the provider. Env var values are write-only: FlowCI sends them to Render or Vercel and stores only metadata.

## Provider Strategy

Render uses the provider-native deployment path for both ownership modes.

Vercel uses the CI-pushed deployment path for both ownership modes:

```text
vercel + flowci_managed => vercel_ci_pushed
vercel + byo            => vercel_ci_pushed
render + any ownership  => provider_native
```

`vercel_git_connected` remains a legacy/future strategy type, but normal project provisioning must not select it.

## Managed Vercel

For FlowCI-managed Vercel targets:

1. FlowCI creates the Vercel project through the Vercel API.
2. The Vercel project is created without `gitRepository`.
3. FlowCI installs per-slot GitHub Actions secrets into the generated GitHub repo.
4. The generated package workflow deploys with the central `vercel-deploy.yml` reusable workflow.

This avoids requiring the user to install the Vercel GitHub App.

Required backend env vars:

```env
ENV_PROVISIONING_ENABLED=true
FLOWCI_VERCEL_TOKEN=<flowci-managed-vercel-token>
FLOWCI_VERCEL_TEAM_ID=<flowci-vercel-team-id>
FLOWCI_VERCEL_TEAM_SLUG=<optional-flowci-vercel-team-slug>
```

`FLOWCI_VERCEL_TEAM_ID` is required for managed Vercel so projects are created in the intended FlowCI-owned Vercel workspace and so `VERCEL_ORG_ID` can be installed correctly for GitHub Actions deploys.

## GitHub Actions Secrets

For CI-pushed Vercel targets, FlowCI installs deterministic per-slot secrets:

```text
VERCEL_FRONTEND_TOKEN
VERCEL_FRONTEND_ORG_ID
VERCEL_FRONTEND_PROJECT_ID

VERCEL_BACKEND_TOKEN
VERCEL_BACKEND_ORG_ID
VERCEL_BACKEND_PROJECT_ID

VERCEL_STANDALONE_TOKEN
VERCEL_STANDALONE_ORG_ID
VERCEL_STANDALONE_PROJECT_ID
```

Managed targets use `FLOWCI_VERCEL_TOKEN`. BYO targets use the user's saved Vercel provider connection token.

## Generated Workflow Contract

Generated package-stage workflows call:

```text
cicd-external-project/cicd-workflow/.github/workflows/vercel-deploy.yml@v1
```

The reusable workflow expects:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

The generated workflow maps those reusable-workflow secrets from the per-slot repository secrets above.

## Live Verification

After deploying backend and frontend to test:

1. Ensure managed Vercel env vars are present in the backend deployment.
2. Create a frontend project with `Managed by FlowCI`.
3. Confirm the setup result says `Deploys through GitHub Actions`.
4. Confirm a Vercel project was created in the configured FlowCI Vercel team.
5. Confirm the generated GitHub repo has the expected per-slot Vercel secrets.
6. Push to `test` and confirm the package workflow deploys through the central Vercel reusable workflow.
