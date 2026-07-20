-- Reverts 20260713062000_hierarchy_assignments_and_sync.sql
--
-- Drop github_access_sync before repository_assignments (FK dependency).
-- Indexes are dropped automatically with their tables.

DROP TABLE IF EXISTS hierarchy.github_access_sync;
DROP TABLE IF EXISTS hierarchy.repository_assignments;
