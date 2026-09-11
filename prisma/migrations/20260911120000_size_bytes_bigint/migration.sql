-- Widen the two byte-count columns that hold a size Drive reported for a file
-- the hub did not upload. INTEGER tops out at 2 GB, so scanning a folder with
-- a single larger file in it aborted the whole import.
ALTER TABLE "Document" ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
ALTER TABLE "ImportItem" ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT;
