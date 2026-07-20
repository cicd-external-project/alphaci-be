-- Reverts 20260713064000_hierarchy_communication_stub.sql
--
-- Drop group_messages before group_channels (FK dependency).

DROP TABLE IF EXISTS hierarchy.group_messages;
DROP TABLE IF EXISTS hierarchy.group_channels;
