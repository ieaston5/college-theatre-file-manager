-- Shared drive provenance.
--
-- A file in a shared drive has no owner as far as Drive is concerned — the
-- drive owns it — so `driveOwnerEmail` is null for every one of them and the
-- hub could not tell them apart from a file whose owner it simply failed to
-- read. These two columns record which shared drive a file came from, which
-- is what lets the ownership chase-list leave them alone.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "driveId" TEXT;
ALTER TABLE "Document" ADD COLUMN "driveName" TEXT;

-- AlterTable
ALTER TABLE "ImportItem" ADD COLUMN "driveId" TEXT;
ALTER TABLE "ImportItem" ADD COLUMN "driveName" TEXT;
