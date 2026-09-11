-- Re-sharing in Drive becomes a queue rather than something the person who
-- pressed Save waits for.
--
-- Per-member sharing is one Google call per person per file, so changing one
-- company member's role re-shared every company document of that show inline —
-- hundreds of calls inside a single request. The intention is now written down
-- per document and drained in the background, which is a single statement to
-- record and nothing to wait for.

ALTER TABLE "Document" ADD COLUMN "sharingDirtyAt" TIMESTAMP(3);

-- The queue is read oldest-first and only ever looks at marked rows, so the
-- index is on the column that decides both.
CREATE INDEX "Document_sharingDirtyAt_idx" ON "Document"("sharingDirtyAt");

-- Carry over a sweep that was already mid-flight. Before this, "stale" meant
-- "not pushed since the sweep started"; that comparison is gone, so anything
-- it still considered outstanding is marked now instead — otherwise a hub
-- upgraded halfway through a sweep would decide it had finished.
UPDATE "Document"
SET "sharingDirtyAt" = COALESCE(
  (SELECT "sharingSweepStartedAt" FROM "OrgConfig" WHERE "id" = 'singleton'),
  CURRENT_TIMESTAMP
)
WHERE "status" = 'ACTIVE'
  AND "googleFileId" IS NOT NULL
  AND "visibility" <> 'PRIVATE'
  AND "docType" <> 'LINK'
  AND EXISTS (
    SELECT 1 FROM "OrgConfig"
    WHERE "id" = 'singleton' AND "sharingSweepStartedAt" IS NOT NULL
  )
  AND (
    "sharingSyncedAt" IS NULL
    OR "sharingSyncedAt" < (
      SELECT "sharingSweepStartedAt" FROM "OrgConfig" WHERE "id" = 'singleton'
    )
  );
