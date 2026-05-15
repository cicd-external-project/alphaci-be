# START_HERE_BACKEND

This document is the onboarding and system map for teams creating a new backend repository from this template.

## 1) What This Repository Is

This repository is a production-ready NestJS backend baseline for tribe services.
It already includes:

- NestJS bootstrap with hardened defaults
- Supabase integration
- APICenter SDK integration
- Health endpoint with dependency checks
- CI/CD caller workflow into central reusable pipelines
- Render deployment integration for test/uat/main branches
- Strict TypeScript + lint/test tooling

Use this template as a starting point, then replace business-domain code with your own modules.

## 2) System Map (How This Template Fits The Platform)

This backend does not run alone. It sits in a wider system:

```text
[Your Tribe Backend Repo]
    |
    |  (via GitHub Actions caller)
    v
[ImplementSprint/central-workflow]
    |
    |-- quality gates, sonar, docker, k6, promotion
  |-- deploy-preview lane (test/uat)
  |-- render-deploy lane (test/uat/main)

[Your Tribe Backend Runtime]
    |
    |-- Supabase (data)
    |-- APICenter (inter-service + external API gateway)
          |
          |-- /tribes/* for tribe-to-tribe calls
          |-- /shared/* for shared platform services
          |-- /external/* for provider-backed integrations (including Kafka REST)
```

Key idea: tribe backends call other services through APICenter, not direct service-to-service network calls.

## 3) Repository Layout Explained

```text
src/
  main.ts
  app.module.ts
  app.controller.ts
  app.service.ts
  common/
    config/
      security.config.ts
      env.validation.ts
    filters/
      all-exceptions.filter.ts
    middleware/
      correlation-id.middleware.ts
  api-center/
    api-center-sdk.module.ts
    api-center-sdk.service.ts
  supabase/
    supabase.module.ts
    supabase.service.ts
  health/
    health.module.ts
    health.controller.ts
    health.service.ts

.github/workflows/
  be-pipeline-caller.yml

.env.example
README.md
```

## 4) Day-0 Setup (Before First Push)

### 4.1 GitHub Repository Variable

Set this repository variable:

- BACKEND_SINGLE_SYSTEMS_JSON

Example value:

```json
{"name":"my-api","dir":".","image":"ghcr.io/<org>/<my-api>"}
```

### 4.2 GitHub Repository Secrets

Set these in repo secrets:

Required for default pipeline behavior:

- SONAR_TOKEN
- SONAR_ORGANIZATION
- SONAR_PROJECT_KEY
- GH_PR_TOKEN
- K6_CLOUD_TOKEN
- K6_CLOUD_PROJECT_ID

Optional:

- RENDER_DEPLOY_HOOK_URL_TEST
- RENDER_DEPLOY_HOOK_URL_UAT
- RENDER_DEPLOY_HOOK_URL_MAIN
- RENDER_HEALTHCHECK_URL_TEST
- RENDER_HEALTHCHECK_URL_UAT
- RENDER_HEALTHCHECK_URL_MAIN
- RENDER_DEPLOY_HOOK_URL (optional fallback)
- RENDER_HEALTHCHECK_URL (optional fallback)

### 4.3 Runtime Secrets (Render or Cluster Secret Store)

Required runtime variables for production deployments:

- NODE_ENV=production
- PORT
- ALLOWED_ORIGINS
- API_CENTER_BASE_URL (or APICENTER_URL alias)
- API_CENTER_TRIBE_ID + API_CENTER_TRIBE_SECRET (preferred)

Supabase requirement (choose one mode):

- Default mode: SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
- Scoped-only mode: at least one <SERVICE>_SUPABASE_URL + <SERVICE>_SUPABASE_SECRET_KEY pair

Optional runtime variables:

- ENABLE_SWAGGER
- API_CENTER_API_KEY (legacy fallback only)
- API_CENTER_TIMEOUT_MS
- APICENTER_TIMEOUT_MS (alias)

For local development, non-production runs are more permissive because strict env validation is only enforced when NODE_ENV=production.

Security note:

- SUPABASE_SERVICE_ROLE_KEY and API_CENTER_TRIBE_SECRET are high-sensitivity secrets.
- Do not commit .env files.
- Prefer environment-scoped secrets and regular rotation.

## 5) What You Must Change First In Code

When creating a new tribe service from this template, change these first:

1. src/app.service.ts
- Update service identity and version strings.

2. src/app.controller.ts
- Replace or remove scaffold endpoint based on your API contract.

3. src/app.module.ts
- Register your feature modules.

4. src/health/health.service.ts
- Keep health checks aligned with dependencies that are truly required for your service.

5. src/api-center/api-center-sdk.service.ts
- Add typed helper methods for your domain integrations if needed.

## 6) APICenter SDK: Where It Is And How To Use It

### 6.1 Where teams find it

- src/api-center/api-center-sdk.service.ts
- src/api-center/api-center-sdk.module.ts

The module is imported in app.module.ts, so any provider can inject ApiCenterSdkService.

### 6.2 Basic usage pattern

```ts
import { Injectable } from '@nestjs/common';
import { ApiCenterSdkService } from '../api-center/api-center-sdk.service.js';

@Injectable()
export class OrdersService {
  constructor(private readonly sdk: ApiCenterSdkService) {}

  async fetchUsersFromTribeB() {
    const result = await this.sdk.get('/tribes/tribe-b/users');
    return result.data;
  }

  async sendSharedNotification(payload: unknown) {
    const result = await this.sdk.post('/shared/notifications/send', payload);
    return result.data;
  }
}
```

### 6.3 Authentication modes

Preferred mode:

- API_CENTER_TRIBE_ID + API_CENTER_TRIBE_SECRET

Legacy fallback mode:

- API_CENTER_API_KEY

Migration path:

1. Provision tribe credentials in APICenter.
2. Set API_CENTER_TRIBE_ID and API_CENTER_TRIBE_SECRET.
3. Validate calls and token refresh behavior.
4. Remove API_CENTER_API_KEY where possible.

## 7) Kafka Through APICenter (Recommended Pattern)

Do not call Kafka providers directly from tribe services.
Use APICenter external routing so policy, tenancy, and auth stay centralized.

### 7.1 Typed helper methods available in template SDK

The template now provides:

- kafkaListClusters()
- kafkaListTopics(clusterId)
- kafkaProduceRecords(clusterId, topic, records)
- buildTenantTopic(tribeId, suffix)

Example:

```ts
const clusters = await this.sdk.kafkaListClusters();
const topics = await this.sdk.kafkaListTopics('lkc-123');

const topic = ApiCenterSdkService.buildTenantTopic('orders-service', 'order-created');

await this.sdk.kafkaProduceRecords('lkc-123', topic, [
  {
    key: 'order-001',
    value: JSON.stringify({ orderId: 'order-001', status: 'created' }),
    headers: { 'x-correlation-id': 'corr-123' },
  },
]);
```

### 7.2 Topic naming and tenancy

Use tenant-scoped names:

- tribe.<tribeId>.<suffix>

Keep suffixes domain-driven and stable.

### 7.3 Platform-side prerequisites

Your tribe must be configured in APICenter with:

- proper scopes (read/write as needed)
- allowlist entries for external kafka integration

Without platform registration and allowlist, calls will be denied.

## 8) Render: How It Works In This System

### 8.1 Branch behavior

- test branch: Render test deployment
- uat branch: Render UAT deployment
- main branch: Render production deployment

### 8.2 CI mode selection for Render lane

Central workflow behavior:

- Caller workflow keeps deploy lanes enabled on push.
- Central `render-deploy` job triggers branch-mapped Render hooks.
- Health verification must return HTTP 200 with `checks.apiCenter=true`.

### 8.3 Runtime setup on Render

1. Create environment(s) on Render for test/uat/main.
2. Add runtime env vars in Render Environment settings.
3. Set ALLOWED_ORIGINS to exact frontend URLs.
4. Use NODE_ENV=production and ENABLE_SWAGGER=false.

## 9) CI/CD Flow (What Happens On Push)

Push to test, uat, or main triggers the caller workflow.
The caller delegates to central-workflow pipeline orchestration.

Typical order:

1. Build and tests
2. Security scan
3. SonarCloud analysis
4. Docker build (main lane)
5. Deploy lanes (central reusable workflow)
6. k6/versioning/promotion orchestration

Important:

- Render deployment is handled in central-workflow (`render-deploy` reusable lane).
- Caller workflow delegates deployment by keeping `run_deploy` enabled on push.
- dry_run mainly impacts manual dispatch scenarios.

## 10) Feature Development Pattern For New Teams

Use this repeatable flow:

1. Create feature module (controller/service/dto/spec)
2. Add module import to app.module.ts
3. Add storage logic via SupabaseService where needed
4. Add external calls via ApiCenterSdkService only
5. Ensure correlation id is preserved in outbound metadata/headers where applicable
6. Add unit tests and e2e tests
7. Run lint/typecheck/tests locally before push

## 11) Common Mistakes To Avoid

- Pushing without BACKEND_SINGLE_SYSTEMS_JSON configured
- Missing branch-specific Render deploy hook or healthcheck secrets
- Using wildcard CORS origins instead of exact values
- Depending on legacy API_CENTER_API_KEY when tribe credentials are available
- Bypassing APICenter for inter-service/external calls
- Skipping API Center health verification after Render deployment

## 12) Commands You Will Use Often

```bash
npm install
npm run start:dev
npm run lint
npm run typecheck
npm run test
npm run test:cov
npm run build
```

## 13) First 24-Hour Checklist For New Tribe Backend

1. Configure GitHub variable and secrets.
2. Configure runtime env vars/secrets.
3. Update service identity and module wiring.
4. Validate health endpoint locally.
5. Push to test branch and verify pipeline + Render test deployment.
6. Verify APICenter authentication mode (tribe credentials preferred).
7. Verify one Kafka read path and one produce path via SDK helpers.
8. Open and validate promotion PR flow to uat/main.

---

If you follow this document, your new tribe backend should start cleanly, deploy correctly, and integrate with APICenter/Kafka without ad-hoc wiring.
