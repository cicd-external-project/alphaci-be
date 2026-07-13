const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();
const { Client } = require('pg');

const migrationNames = [
  '20260713060000_group_lifecycle.sql',
  '20260713061000_hierarchy_core.sql',
  '20260713062000_hierarchy_assignments_and_sync.sql',
  '20260713063000_hierarchy_config_broker.sql',
  '20260713064000_hierarchy_communication_stub.sql',
  '20260714000000_role_value_rename.sql',
];

async function inspect(client) {
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'orgs' AND table_name = 'workspaces' AND column_name = 'description'
      ) AS has_description,
      to_regclass('orgs.group_invitations') IS NOT NULL AS has_invitations,
      to_regclass('hierarchy.systems') IS NOT NULL AS has_systems,
      to_regclass('hierarchy.repository_assignments') IS NOT NULL AS has_assignments,
      to_regclass('hierarchy.github_access_sync') IS NOT NULL AS has_access_sync;
  `);
  const roles = await client.query(
    `SELECT role, count(*)::int AS count FROM orgs.workspace_members GROUP BY role ORDER BY role;`,
  );
  const rolesByWorkspaceKind = await client.query(`
    SELECT w.kind, m.role, count(*)::int AS count
    FROM orgs.workspace_members m
    JOIN orgs.workspaces w ON w.id = m.workspace_id
    GROUP BY w.kind, m.role
    ORDER BY w.kind, m.role;
  `);
  const ownerRoles = await client.query(`
    SELECT m.role, count(*)::int AS count
    FROM orgs.workspaces w
    JOIN orgs.workspace_members m
      ON m.workspace_id = w.id
     AND m.user_id = w.owner_user_id
    WHERE w.kind = 'team'
    GROUP BY m.role
    ORDER BY m.role;
  `);
  const roleConstraint = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'orgs'
      AND t.relname = 'workspace_members'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%';
  `);
  return {
    ...result.rows[0],
    roles: roles.rows,
    rolesByWorkspaceKind: rolesByWorkspaceKind.rows,
    ownerRoles: ownerRoles.rows,
    roleConstraint: roleConstraint.rows.map((row) => row.definition),
  };
}

async function main() {
  const mode = process.argv[2] ?? 'verify';
  if (!['verify', 'apply'].includes(mode)) {
    throw new Error('Usage: node scripts/hierarchy-migrations.cjs [verify|apply]');
  }
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL or DATABASE_URL is required');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log(JSON.stringify(await inspect(client)));
    if (mode === 'apply') {
      for (const migrationName of migrationNames) {
        const migrationPath = path.join(
          __dirname,
          '..',
          'supabase',
          'migrations',
          migrationName,
        );
        console.log(`Applying ${migrationName}`);
        await client.query(fs.readFileSync(migrationPath, 'utf8'));
      }
      console.log(JSON.stringify(await inspect(client)));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
