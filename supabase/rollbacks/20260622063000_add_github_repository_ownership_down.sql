DROP TABLE IF EXISTS github_app.webhook_deliveries;

ALTER TABLE github_app.github_installation_accounts
  DROP COLUMN IF EXISTS account_type;
