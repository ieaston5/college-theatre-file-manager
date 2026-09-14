-- Rehearsal recordings can exceed the signed 32-bit integer size limit.
ALTER TABLE "PendingUpload" ALTER COLUMN "sizeBytes" TYPE BIGINT;
ALTER TABLE "PendingUpload" ADD COLUMN "uploadedFileId" TEXT;
