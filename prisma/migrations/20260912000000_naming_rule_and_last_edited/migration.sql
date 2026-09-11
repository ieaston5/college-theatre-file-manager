-- Hub titles now follow the same naming rule as the file names in Drive, and
-- lists are ordered by when the document itself last changed rather than when
-- its hub row did.

-- The name before the rule is applied. Existing titles are exactly that —
-- what somebody typed — so they seed it as-is; the pass that composes the
-- displayed titles runs from the app, where the rule and its tokens live.
ALTER TABLE "Document" ADD COLUMN "baseTitle" TEXT;
UPDATE "Document" SET "baseTitle" = "title" WHERE "baseTitle" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "baseTitle" SET NOT NULL;

-- Google's modified time where the hub has it, the row's own otherwise.
ALTER TABLE "Document" ADD COLUMN "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Document" SET "lastEditedAt" = COALESCE("googleModifiedAt", "updatedAt");

CREATE INDEX "Document_lastEditedAt_idx" ON "Document"("lastEditedAt");

-- How far the scheduled Drive check has read, and when the naming rule was
-- last applied to every title.
ALTER TABLE "OrgConfig" ADD COLUMN "lastDriveScanAt" TIMESTAMP(3);
ALTER TABLE "OrgConfig" ADD COLUMN "titlesNormalisedAt" TIMESTAMP(3);
