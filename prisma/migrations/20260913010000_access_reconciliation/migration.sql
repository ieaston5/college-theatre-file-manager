ALTER TABLE "Document" ADD COLUMN "sharingAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "sharingError" TEXT,
  ADD COLUMN "managedDrivePermissions" TEXT;
ALTER TABLE "OrgConfig" ADD COLUMN "driveScanPageToken" TEXT,
  ADD COLUMN "driveScanSince" TIMESTAMP(3),
  ADD COLUMN "driveScanStartedAt" TIMESTAMP(3);
-- Revisit every file, including archived and private files, with the corrected rules.
UPDATE "OrgConfig" SET "sharingSweepStartedAt" = CURRENT_TIMESTAMP;
UPDATE "Document" SET "sharingDirtyAt" = CURRENT_TIMESTAMP
WHERE "googleFileId" IS NOT NULL AND "docType" <> 'LINK';
-- Remove private titles previously exposed by automatic Canva refresh events.
UPDATE "AuditLog" SET "summary" = 'The hub refreshed a private Canva copy because its original changed'
WHERE "action" = 'canva.export' AND "actorId" IS NULL
  AND "targetType" = 'Document' AND "targetId" IN (
    SELECT "id" FROM "Document" WHERE "visibility" = 'PRIVATE'
  );
