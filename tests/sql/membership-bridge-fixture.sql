-- Apply to an empty local hub_bridge_test database after migrations preceding
-- 20260914000000_multiple_roles_and_sharing_version, before that migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'hub_bridge_test' OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
    RAISE EXCEPTION 'Use the isolated local hub_bridge_test database';
  END IF;
END $$;

INSERT INTO "OrgConfig" ("id", "orgName", "updatedAt") VALUES ('singleton', 'Bridge regression', NOW());
INSERT INTO "User" ("id", "email", "role", "status", "updatedAt") VALUES
  ('bridge-user', 'bridge@example.test', 'COMPANY', 'ACTIVE', NOW()),
  ('bridge-null-user', 'bridge-null@example.test', 'COMPANY', 'ACTIVE', NOW()),
  ('bridge-insert-user', 'bridge-insert@example.test', 'COMPANY', 'ACTIVE', NOW());
INSERT INTO "Production" ("id", "name", "slug", "updatedAt") VALUES
  ('bridge-show', 'Bridge Show', 'bridge-show', NOW()),
  ('bridge-other-show', 'Other Show', 'bridge-other-show', NOW());
INSERT INTO "Category" ("id", "name", "slug", "companyVisible", "updatedAt")
VALUES ('bridge-category', 'Bridge Category', 'bridge-category', TRUE, NOW());
INSERT INTO "ProductionRole" ("id", "name", "slug", "updatedAt") VALUES
  ('bridge-cast', 'Bridge Cast', 'bridge-cast', NOW()),
  ('bridge-lighting', 'Bridge Lighting', 'bridge-lighting', NOW());
INSERT INTO "ProductionMember" ("id", "productionId", "userId", "roleId", "title", "updatedAt") VALUES
  ('bridge-member', 'bridge-show', 'bridge-user', 'bridge-cast', 'Ensemble', NOW()),
  ('bridge-unassigned', 'bridge-show', 'bridge-null-user', NULL, 'Unassigned', NOW());
INSERT INTO "Document" ("id", "title", "baseTitle", "docType", "visibility", "status", "googleFileId", "categoryId", "productionId", "creatorId", "updatedAt") VALUES
  ('bridge-company', 'Company', 'Company', 'DOC', 'COMPANY', 'ACTIVE', 'bridge-company', 'bridge-category', 'bridge-show', 'bridge-user', NOW()),
  ('bridge-private', 'Private', 'Private', 'DOC', 'PRIVATE', 'ACTIVE', 'bridge-private', 'bridge-category', 'bridge-show', 'bridge-user', NOW()),
  ('bridge-archived', 'Archived', 'Archived', 'DOC', 'BOARD', 'ARCHIVED', 'bridge-archived', 'bridge-category', 'bridge-show', 'bridge-user', NOW()),
  ('bridge-org', 'Org', 'Org', 'DOC', 'COMPANY', 'ACTIVE', 'bridge-org', 'bridge-category', NULL, 'bridge-user', NOW()),
  ('bridge-other', 'Other', 'Other', 'DOC', 'COMPANY', 'ACTIVE', 'bridge-other', 'bridge-category', 'bridge-other-show', 'bridge-user', NOW()),
  ('bridge-link', 'Link', 'Link', 'LINK', 'COMPANY', 'ACTIVE', 'bridge-link', 'bridge-category', 'bridge-show', 'bridge-user', NOW()),
  ('bridge-no-file', 'No file', 'No file', 'DOC', 'COMPANY', 'ACTIVE', NULL, 'bridge-category', 'bridge-show', 'bridge-user', NOW());
