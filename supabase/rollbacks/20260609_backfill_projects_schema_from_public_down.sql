-- Rollback: migrate_legacy_public_schema
-- Recreates legacy public tables and backfills them from separated schemas.
-- Session rows are intentionally recreated empty because they are transient
-- and may contain stale session user IDs after identity mapping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  github_user_id   TEXT        UNIQUE,
  google_user_id   TEXT        UNIQUE,
  login            TEXT        NOT NULL,
  display_name     TEXT,
  email            TEXT,
  avatar_url       TEXT,
  provider         TEXT        NOT NULL DEFAULT 'github',
  is_dummy         BOOLEAN     NOT NULL DEFAULT false,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_github_user_id
  ON public.app_users (github_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_login
  ON public.app_users (login);

INSERT INTO public.app_users (
  id,
  github_user_id,
  google_user_id,
  login,
  display_name,
  email,
  avatar_url,
  provider,
  is_dummy,
  last_login_at,
  created_at,
  updated_at
)
SELECT
  id,
  github_user_id,
  google_user_id,
  login,
  display_name,
  email,
  avatar_url,
  provider,
  is_dummy,
  last_login_at,
  created_at,
  updated_at
FROM identity.app_users
ON CONFLICT (id) DO UPDATE SET
  github_user_id = EXCLUDED.github_user_id,
  google_user_id = EXCLUDED.google_user_id,
  login = EXCLUDED.login,
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  avatar_url = EXCLUDED.avatar_url,
  provider = EXCLUDED.provider,
  is_dummy = EXCLUDED.is_dummy,
  last_login_at = EXCLUDED.last_login_at,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  amount_php    NUMERIC     NOT NULL DEFAULT 0,
  interval_unit TEXT        NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('month', 'year')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.subscription_plans (
  code,
  name,
  amount_php,
  interval_unit,
  created_at,
  updated_at
)
SELECT
  code,
  name,
  amount_php,
  interval_unit,
  created_at,
  updated_at
FROM billing.subscription_plans
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  amount_php = EXCLUDED.amount_php,
  interval_unit = EXCLUDED.interval_unit,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               TEXT        NOT NULL,
  plan                  TEXT        NOT NULL,
  plan_code             TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'canceled')),
  provider              TEXT        NOT NULL DEFAULT 'supabase',
  amount_php            NUMERIC     NOT NULL DEFAULT 0,
  interval_unit         TEXT        NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('month', 'year')),
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN     NOT NULL DEFAULT false,
  canceled_at           TIMESTAMPTZ,
  metadata              JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id
  ON public.user_subscriptions (user_id);

INSERT INTO public.user_subscriptions (
  id,
  user_id,
  plan,
  plan_code,
  status,
  provider,
  amount_php,
  interval_unit,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  canceled_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  id,
  user_id::text,
  plan,
  plan_code,
  status,
  provider,
  amount_php,
  interval_unit,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  canceled_at,
  metadata,
  created_at,
  updated_at
FROM billing.user_subscriptions
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  plan = EXCLUDED.plan,
  plan_code = EXCLUDED.plan_code,
  status = EXCLUDED.status,
  provider = EXCLUDED.provider,
  amount_php = EXCLUDED.amount_php,
  interval_unit = EXCLUDED.interval_unit,
  current_period_start = EXCLUDED.current_period_start,
  current_period_end = EXCLUDED.current_period_end,
  cancel_at_period_end = EXCLUDED.cancel_at_period_end,
  canceled_at = EXCLUDED.canceled_at,
  metadata = EXCLUDED.metadata,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.workflow_generations (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                TEXT        NOT NULL,
  template_id            TEXT        NOT NULL,
  template_name          TEXT        NOT NULL,
  stack                  TEXT        NOT NULL,
  service_name           TEXT        NOT NULL,
  output_file_name       TEXT        NOT NULL,
  source_workflow_file   TEXT        NOT NULL DEFAULT '',
  source_properties_file TEXT        NOT NULL DEFAULT '',
  line_count             INTEGER     NOT NULL DEFAULT 0,
  yaml                   TEXT        NOT NULL DEFAULT '',
  sha256                 TEXT        NOT NULL DEFAULT '',
  metadata               JSONB       NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_generations_user_id
  ON public.workflow_generations (user_id, created_at DESC);

INSERT INTO public.workflow_generations (
  id,
  user_id,
  template_id,
  template_name,
  stack,
  service_name,
  output_file_name,
  source_workflow_file,
  source_properties_file,
  line_count,
  yaml,
  sha256,
  metadata,
  created_at
)
SELECT
  id,
  user_id::text,
  template_id,
  template_name,
  stack,
  service_name,
  output_file_name,
  source_workflow_file,
  source_properties_file,
  line_count,
  yaml,
  sha256::text,
  metadata,
  created_at
FROM workflow.workflow_generations
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  template_id = EXCLUDED.template_id,
  template_name = EXCLUDED.template_name,
  stack = EXCLUDED.stack,
  service_name = EXCLUDED.service_name,
  output_file_name = EXCLUDED.output_file_name,
  source_workflow_file = EXCLUDED.source_workflow_file,
  source_properties_file = EXCLUDED.source_properties_file,
  line_count = EXCLUDED.line_count,
  yaml = EXCLUDED.yaml,
  sha256 = EXCLUDED.sha256,
  metadata = EXCLUDED.metadata;

CREATE TABLE IF NOT EXISTS public.provisioned_projects (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  repo_full_name      TEXT          NOT NULL,
  template_id         TEXT          NOT NULL,
  service_name        TEXT          NOT NULL,
  workflow_path       TEXT          NOT NULL,
  status              TEXT          NOT NULL CHECK (status IN ('provisioning', 'provisioned', 'failed', 'orphaned')),
  github_commit_sha   TEXT          NULL,
  github_commit_url   TEXT          NULL,
  failure_reason      TEXT          NULL,
  repo_url            TEXT          NULL,
  visibility          TEXT          NULL,
  repo_shape          TEXT          NULL,
  project_type_id     TEXT          NULL,
  workflow_recipe_id  TEXT          NULL,
  project_options     JSONB         NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provisioned_projects_user_id
  ON public.provisioned_projects (user_id, created_at DESC);

INSERT INTO public.provisioned_projects (
  id,
  user_id,
  repo_full_name,
  template_id,
  service_name,
  workflow_path,
  status,
  github_commit_sha,
  github_commit_url,
  failure_reason,
  repo_url,
  visibility,
  repo_shape,
  project_type_id,
  workflow_recipe_id,
  project_options,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  repo_full_name,
  template_id,
  service_name,
  workflow_path,
  status,
  github_commit_sha,
  github_commit_url,
  failure_reason,
  github_repository_url,
  visibility,
  repo_shape,
  project_type_id,
  workflow_recipe_id,
  project_options,
  created_at,
  updated_at
FROM projects.provisioned_projects
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  repo_full_name = EXCLUDED.repo_full_name,
  template_id = EXCLUDED.template_id,
  service_name = EXCLUDED.service_name,
  workflow_path = EXCLUDED.workflow_path,
  status = EXCLUDED.status,
  github_commit_sha = EXCLUDED.github_commit_sha,
  github_commit_url = EXCLUDED.github_commit_url,
  failure_reason = EXCLUDED.failure_reason,
  repo_url = EXCLUDED.repo_url,
  visibility = EXCLUDED.visibility,
  repo_shape = EXCLUDED.repo_shape,
  project_type_id = EXCLUDED.project_type_id,
  workflow_recipe_id = EXCLUDED.workflow_recipe_id,
  project_options = EXCLUDED.project_options,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.project_ci_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES projects.provisioned_projects(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  token_prefix  TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at    TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id)
);

INSERT INTO public.project_ci_tokens (
  id,
  project_id,
  token_hash,
  token_prefix,
  status,
  revoked_at,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  token_hash,
  token_prefix,
  status,
  revoked_at,
  created_at,
  updated_at
FROM ci.project_ci_tokens
ON CONFLICT (project_id) DO UPDATE SET
  token_hash = EXCLUDED.token_hash,
  token_prefix = EXCLUDED.token_prefix,
  status = EXCLUDED.status,
  revoked_at = EXCLUDED.revoked_at,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.github_installations (
  id                   BIGSERIAL PRIMARY KEY,
  installation_id      BIGINT        NOT NULL,
  user_id              TEXT          NOT NULL,
  account_login        TEXT,
  account_id           BIGINT,
  repository_selection TEXT          NOT NULL DEFAULT 'selected' CHECK (repository_selection IN ('all', 'selected')),
  repos_linked         INTEGER       NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT github_installations_installation_id_key UNIQUE (installation_id)
);

CREATE INDEX IF NOT EXISTS idx_github_installations_user_id
  ON public.github_installations (user_id);

INSERT INTO public.github_installations (
  installation_id,
  user_id,
  account_login,
  account_id,
  repository_selection,
  repos_linked,
  created_at,
  updated_at
)
SELECT
  a.installation_id,
  a.user_id::text,
  a.account_login,
  a.account_id,
  a.repository_selection,
  (
    SELECT COUNT(*)::integer
    FROM github_app.github_installations r
    WHERE r.user_id = a.user_id
      AND r.installation_id = a.installation_id
      AND r.suspended_at IS NULL
  ),
  a.created_at,
  a.updated_at
FROM github_app.github_installation_accounts a
ON CONFLICT (installation_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  account_login = EXCLUDED.account_login,
  account_id = EXCLUDED.account_id,
  repository_selection = EXCLUDED.repository_selection,
  repos_linked = EXCLUDED.repos_linked,
  updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.github_installation_repos (
  id               BIGSERIAL PRIMARY KEY,
  installation_id  BIGINT  NOT NULL REFERENCES public.github_installations (installation_id) ON DELETE CASCADE,
  repo_full_name   TEXT    NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_installation_repos_unique UNIQUE (installation_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_github_installation_repos_installation_id
  ON public.github_installation_repos (installation_id);

INSERT INTO public.github_installation_repos (
  installation_id,
  repo_full_name,
  created_at
)
SELECT DISTINCT
  installation_id,
  repo_full_name,
  created_at
FROM github_app.github_installations
WHERE suspended_at IS NULL
ON CONFLICT (installation_id, repo_full_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  topic          TEXT        NOT NULL,
  aggregate_type TEXT        NOT NULL,
  aggregate_id   TEXT        NOT NULL,
  payload        JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status
  ON public.outbox_events (status, created_at);

INSERT INTO public.outbox_events (
  id,
  topic,
  aggregate_type,
  aggregate_id,
  payload,
  status,
  created_at,
  processed_at
)
SELECT
  COALESCE(NULLIF(payload ->> 'legacyPublicOutboxId', '')::uuid, gen_random_uuid()),
  topic,
  aggregate_type,
  aggregate_id,
  payload - 'legacyPublicOutboxId' - 'source',
  CASE
    WHEN status = 'published' THEN 'published'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  created_at,
  published_at
FROM platform.outbox_events
WHERE payload ->> 'source' = 'legacy_public_outbox_events_backfill'
ON CONFLICT (id) DO UPDATE SET
  topic = EXCLUDED.topic,
  aggregate_type = EXCLUDED.aggregate_type,
  aggregate_id = EXCLUDED.aggregate_id,
  payload = EXCLUDED.payload,
  status = EXCLUDED.status,
  processed_at = EXCLUDED.processed_at;

CREATE TABLE IF NOT EXISTS public.session (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_session_expire
  ON public.session (expire);

CREATE TABLE IF NOT EXISTS public.oauth_states (
  state       TEXT        NOT NULL PRIMARY KEY,
  return_to   TEXT        NOT NULL DEFAULT '/',
  provider    TEXT        NOT NULL DEFAULT 'github',
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON public.oauth_states (expires_at);

INSERT INTO public.oauth_states (
  state,
  return_to,
  provider,
  expires_at,
  created_at
)
SELECT
  state,
  return_to,
  provider,
  expires_at,
  created_at
FROM identity.oauth_states
ON CONFLICT (state) DO UPDATE SET
  return_to = EXCLUDED.return_to,
  provider = EXCLUDED.provider,
  expires_at = EXCLUDED.expires_at,
  created_at = EXCLUDED.created_at;

COMMIT;
