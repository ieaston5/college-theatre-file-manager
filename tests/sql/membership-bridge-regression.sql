-- This optional PostgreSQL regression does not run in npm test.
-- Use an EMPTY local hub_bridge_test database. From the repository root:
--   export TEST_DATABASE_URL='postgresql://hubtest@127.0.0.1:54339/hub_bridge_test?sslmode=disable'
--   for migration in prisma/migrations/*/migration.sql; do
--     case "$migration" in *20260914000000_*) break;; esac
--     psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
--   done
--   psql "$TEST_DATABASE_URL" -f tests/sql/membership-bridge-fixture.sql
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260914000000_multiple_roles_and_sharing_version/migration.sql
--   psql "$TEST_DATABASE_URL" -f tests/sql/membership-bridge-regression.sql
-- The final regression rolls back its own mutations; drop the isolated DB afterwards.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'hub_bridge_test' OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
    RAISE EXCEPTION 'Use the isolated local hub_bridge_test database';
  END IF;
END $$;

CREATE FUNCTION pg_temp.assert_roles(member_id TEXT, expected TEXT[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg("roleId" ORDER BY "roleId"), ARRAY[]::TEXT[]) INTO actual
  FROM "ProductionMemberRole" WHERE "memberId" = member_id;
  IF actual <> expected THEN RAISE EXCEPTION 'Roles for %: expected %, got %', member_id, expected, actual; END IF;
END $$;

-- Migration backfill preserves both a role and deliberate unassignment.
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast']);
SELECT pg_temp.assert_roles('bridge-unassigned', ARRAY[]::TEXT[]);
DO $$ BEGIN
  IF (SELECT "title" FROM "ProductionMember" WHERE "id" = 'bridge-member') <> 'Ensemble' THEN RAISE EXCEPTION 'Backfill changed title'; END IF;
  IF EXISTS (SELECT 1 FROM "Document" WHERE "googleFileId" IS NOT NULL AND "docType" <> 'LINK' AND ("sharingDirtyAt" IS NULL OR "sharingVersion" <> 1)) THEN
    RAISE EXCEPTION 'Migration did not queue all file generations';
  END IF;
END $$;

UPDATE "Document" SET "sharingDirtyAt" = NULL, "sharingVersion" = 10;
-- An old server replaces the single role after deployment has begun.
UPDATE "ProductionMember" SET "roleId" = 'bridge-lighting' WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-lighting']);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Document" WHERE "id" IN ('bridge-company', 'bridge-private', 'bridge-archived', 'bridge-org') AND ("sharingDirtyAt" IS NULL OR "sharingVersion" <> 11)) THEN
    RAISE EXCEPTION 'Legacy write missed show/private/archived/org audience generations';
  END IF;
  IF EXISTS (SELECT 1 FROM "Document" WHERE "id" IN ('bridge-other', 'bridge-link', 'bridge-no-file') AND ("sharingDirtyAt" IS NOT NULL OR "sharingVersion" <> 10)) THEN
    RAISE EXCEPTION 'Legacy write queued unrelated or unpushable records';
  END IF;
END $$;

-- Modern nested assignments can happen before OR after roleId=null. Neither
-- ordering may erase selected assignments, and repeated null saves are safe.
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId") VALUES ('modern-cast', 'bridge-member', 'bridge-cast');
UPDATE "ProductionMember" SET "roleId" = NULL WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast', 'bridge-lighting']);
UPDATE "ProductionMember" SET "roleId" = NULL, "title" = 'Ensemble and lighting' WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast', 'bridge-lighting']);
DELETE FROM "ProductionMemberRole" WHERE "memberId" = 'bridge-member' AND "roleId" = 'bridge-lighting';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast']);

-- An old writer intentionally replaces the role set, including a re-selection
-- of the same non-null legacy role when newer assignments exist alongside it.
UPDATE "ProductionMember" SET "roleId" = 'bridge-lighting' WHERE "id" = 'bridge-member';
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId") VALUES ('modern-cast-again', 'bridge-member', 'bridge-cast');
UPDATE "ProductionMember" SET "title" = 'Title-only save' WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast', 'bridge-lighting']);
UPDATE "ProductionMember" SET "roleId" = 'bridge-lighting' WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-lighting']);

-- SET NULL from deletion of the legacy role must retain a different modern
-- assignment. The join's FK cascade removes the deleted role alone.
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId") VALUES ('modern-surviving-cast', 'bridge-member', 'bridge-cast');
DELETE FROM "ProductionRole" WHERE "id" = 'bridge-lighting';
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast']);
DO $$ BEGIN
  IF (SELECT "roleId" FROM "ProductionMember" WHERE "id" = 'bridge-member') IS NOT NULL THEN RAISE EXCEPTION 'Legacy FK was not cleared'; END IF;
END $$;

-- Clearing modern assignments cannot revive the now-null legacy role.
DELETE FROM "ProductionMemberRole" WHERE "memberId" = 'bridge-member';
UPDATE "ProductionMember" SET "roleId" = NULL WHERE "id" = 'bridge-member';
SELECT pg_temp.assert_roles('bridge-member', ARRAY[]::TEXT[]);
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId") VALUES ('modern-after-null', 'bridge-member', 'bridge-cast');
SELECT pg_temp.assert_roles('bridge-member', ARRAY['bridge-cast']);

-- Old inserts and membership removal during a mixed-version rollout work too.
INSERT INTO "ProductionMember" ("id", "productionId", "userId", "roleId", "updatedAt")
VALUES ('bridge-insert', 'bridge-show', 'bridge-insert-user', 'bridge-cast', NOW());
SELECT pg_temp.assert_roles('bridge-insert', ARRAY['bridge-cast']);
UPDATE "Document" SET "sharingDirtyAt" = NULL, "sharingVersion" = 20;
DELETE FROM "ProductionMember" WHERE "id" = 'bridge-insert';
SELECT pg_temp.assert_roles('bridge-insert', ARRAY[]::TEXT[]);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Document" WHERE "id" IN ('bridge-company', 'bridge-private', 'bridge-archived', 'bridge-org') AND ("sharingDirtyAt" IS NULL OR "sharingVersion" <> 21)) THEN
    RAISE EXCEPTION 'Legacy removal missed affected file generations';
  END IF;
END $$;

-- A new insert with the legacy column null starts unassigned; its nested
-- role writes remain authoritative after creation and subsequent null saves.
INSERT INTO "ProductionMember" ("id", "productionId", "userId", "roleId", "updatedAt")
VALUES ('bridge-modern-insert', 'bridge-show', 'bridge-insert-user', NULL, NOW());
SELECT pg_temp.assert_roles('bridge-modern-insert', ARRAY[]::TEXT[]);
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId")
VALUES ('bridge-modern-insert-cast', 'bridge-modern-insert', 'bridge-cast');
UPDATE "ProductionMember" SET "roleId" = NULL WHERE "id" = 'bridge-modern-insert';
SELECT pg_temp.assert_roles('bridge-modern-insert', ARRAY['bridge-cast']);

ROLLBACK;
\echo 'Membership bridge PostgreSQL regression passed.'
