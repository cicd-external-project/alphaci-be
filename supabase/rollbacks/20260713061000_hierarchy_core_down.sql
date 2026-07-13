-- Reverts 20260713061000_hierarchy_core.sql
--
-- Drop children before parents (repositories -> delivery_projects ->
-- systems); indexes and column comments are dropped automatically with
-- their tables. The hierarchy schema itself is only dropped here on the
-- assumption this rollback runs AFTER the rollbacks for
-- 20260713062000/20260713063000/20260713064000 (i.e. migrations are rolled
-- back in reverse chronological order) — if the schema is not yet empty
-- this DROP SCHEMA simply fails loudly instead of cascading into unrelated
-- objects, which is the intended safety behavior.

DROP TABLE IF EXISTS hierarchy.repositories;
DROP TABLE IF EXISTS hierarchy.delivery_projects;
DROP TABLE IF EXISTS hierarchy.systems;

DROP SCHEMA IF EXISTS hierarchy;
