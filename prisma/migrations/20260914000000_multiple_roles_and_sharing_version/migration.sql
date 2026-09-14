BEGIN;
-- Freeze legacy membership writes until the backfill and its write bridge are
-- both installed. Reads continue, and there is no backfill/deploy write gap.
LOCK TABLE "ProductionMember" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Document" ADD COLUMN "sharingVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sharingLockToken" TEXT,
  ADD COLUMN "sharingLockExpiresAt" TIMESTAMP(3);
CREATE TABLE "ProductionMemberRole" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  CONSTRAINT "ProductionMemberRole_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionMemberRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProductionMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductionMemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ProductionRole"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionMemberRole_memberId_roleId_key" ON "ProductionMemberRole"("memberId", "roleId");
CREATE INDEX "ProductionMemberRole_roleId_idx" ON "ProductionMemberRole"("roleId");
-- Preserve existing assignments. Runtime reads only the join, never the legacy column.
INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId")
SELECT 'legacy_' || md5("id" || ':' || "roleId"), "id", "roleId"
FROM "ProductionMember" WHERE "roleId" IS NOT NULL;

-- During a rolling deployment, old instances still write the single roleId.
-- A non-null legacy assignment replaces the role set, even when reselecting
-- the same role. New instances set roleId to null and write the join instead;
-- null is a handoff marker, not an instruction to delete those assignments.
-- The old form requires a role and removes a person by deleting membership.
-- A role FK's SET NULL consequently leaves any other assigned roles intact;
-- the join FK's CASCADE removes only the role actually deleted.
CREATE FUNCTION "bridgeLegacyProductionMemberRole"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  production_id TEXT;
  audience_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    production_id := OLD."productionId";
    audience_changed := TRUE;
  ELSE
    production_id := NEW."productionId";
    IF NEW."roleId" IS NOT NULL THEN
      DELETE FROM "ProductionMemberRole"
      WHERE "memberId" = NEW."id" AND "roleId" <> NEW."roleId";
      INSERT INTO "ProductionMemberRole" ("id", "memberId", "roleId")
      VALUES ('legacy_' || md5(NEW."id" || ':' || NEW."roleId"), NEW."id", NEW."roleId")
      ON CONFLICT ("memberId", "roleId") DO NOTHING;
      audience_changed := TRUE;
    ELSIF TG_OP = 'UPDATE' AND OLD."roleId" IS NOT NULL THEN
      audience_changed := TRUE;
    END IF;
  END IF;

  IF audience_changed THEN
    -- Old instances only queued COMPANY files and knew nothing of generations.
    -- Queue every affected file here so private/named grants are revoked too,
    -- and an in-flight new worker cannot acknowledge an obsolete audience.
    UPDATE "Document"
    SET "sharingDirtyAt" = CURRENT_TIMESTAMP, "sharingVersion" = "sharingVersion" + 1
    WHERE "googleFileId" IS NOT NULL AND "docType" <> 'LINK'
      AND ("productionId" = production_id OR "productionId" IS NULL);
    UPDATE "OrgConfig"
    SET "sharingSweepStartedAt" = COALESCE("sharingSweepStartedAt", CURRENT_TIMESTAMP)
    WHERE "id" = 'singleton';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "ProductionMember_legacy_role_bridge"
AFTER INSERT OR UPDATE OF "roleId" OR DELETE ON "ProductionMember"
FOR EACH ROW EXECUTE FUNCTION "bridgeLegacyProductionMemberRole"();

-- Reconcile the stricter production boundary, including old named shares.
UPDATE "Document" SET "sharingDirtyAt" = CURRENT_TIMESTAMP,
  "sharingVersion" = "sharingVersion" + 1
WHERE "googleFileId" IS NOT NULL AND "docType" <> 'LINK';
UPDATE "OrgConfig" SET "sharingSweepStartedAt" = CURRENT_TIMESTAMP;
COMMIT;
