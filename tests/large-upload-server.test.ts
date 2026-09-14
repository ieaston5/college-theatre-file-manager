import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { readSmallUploadBody, UploadBodyError } from "../lib/upload-body";
import { UPLOAD_MAX_BYTES, UPLOAD_SERVER_MAX_BYTES } from "../lib/constants";
import { uploadStartSchema } from "../lib/validation";

const originalFetch = globalThis.fetch;
let upload: typeof import("../lib/google/upload");
let documents: typeof import("../lib/documents");
const fake: Record<string, any> = {};
before(async () => {
  process.env.DRIVE_MODE = "mock";
  (globalThis as any).prisma = fake;
  upload = await import("../lib/google/upload");
  documents = await import("../lib/documents");
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("recording metadata accepts sizes above 2 GiB up to 20 GiB and rejects empty/oversized files", () => {
  const metadata = { fileName: "rehearsal.mov", mimeType: "video/quicktime" };
  for (const sizeBytes of [3 * 1024 ** 3, UPLOAD_MAX_BYTES]) {
    assert.equal(uploadStartSchema.parse({ ...metadata, sizeBytes }).sizeBytes, sizeBytes);
  }
  assert.equal(uploadStartSchema.safeParse({ ...metadata, sizeBytes: UPLOAD_MAX_BYTES + 1 }).success, false);
  assert.equal(uploadStartSchema.safeParse({ ...metadata, sizeBytes: 0 }).success, false);
});

test("Google status checks send zero bytes and preserve the acknowledged offset above 2 GiB", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://www.googleapis.com/upload/session");
    assert.equal(init?.method, "PUT");
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("Content-Range"), `bytes */${UPLOAD_MAX_BYTES}`);
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 308, headers: { Range: "bytes=0-3221225471" } });
  };
  assert.deepEqual(await upload.resumableUploadStatus("https://www.googleapis.com/upload/session", UPLOAD_MAX_BYTES), {
    complete: false, offset: 3 * 1024 ** 3,
  });
});

test("Google empty, complete, expired and transient status responses are distinguished", async () => {
  globalThis.fetch = async () => new Response(null, { status: 308 });
  assert.deepEqual(await upload.resumableUploadStatus("https://example.test/session", 100), { complete: false, offset: 0 });
  for (const status of [200, 201]) {
    globalThis.fetch = async () => Response.json({ id: "recording" }, { status });
    assert.deepEqual(await upload.resumableUploadStatus("https://example.test/session", 100), { complete: true, offset: 100, fileId: "recording" });
  }
  for (const status of [404, 410, 429, 500, 503]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(upload.resumableUploadStatus("https://example.test/session", 100), (error: any) => {
      assert.equal(error.retryable, status >= 429);
      assert.equal(error.status, status >= 429 ? 503 : 410);
      return true;
    });
  }
  globalThis.fetch = async () => { throw new TypeError("network offline"); };
  await assert.rejects(upload.resumableUploadStatus("https://example.test/session", 100), (error: any) => error.retryable && error.status === 502);
});

test("invalid Google byte ranges never become a resume offset", async () => {
  for (const range of ["bytes=1-5", "bytes=0-101", "garbage", "bytes=0-999999999999999999999"]) {
    globalThis.fetch = async () => new Response(null, { status: 308, headers: { Range: range } });
    await assert.rejects(upload.resumableUploadStatus("https://example.test/session", 100), (error: any) => error.retryable);
  }
});

test("Google 403 throttling retains progress while storage and invalid sessions terminate clearly", async () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded", "storageQuotaExceeded", "insufficientPermissions"]) {
    globalThis.fetch = async () => Response.json({ error: { errors: [{ reason }] } }, { status: 403 });
    await assert.rejects(upload.resumableUploadStatus("https://example.test/session", 100), (error: any) => {
      if (reason.endsWith("RateLimitExceeded") || reason === "rateLimitExceeded") {
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
      } else {
        assert.equal(error.status, reason === "storageQuotaExceeded" ? 403 : 410);
        assert.equal(error.retryable, false);
        if (reason === "storageQuotaExceeded") assert.match(error.message, /out of storage/);
      }
      return true;
    });
  }
  for (const status of [400, 401, 409]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(upload.resumableUploadStatus("https://example.test/session", 100), (error: any) => error.status === 410 && !error.retryable);
  }
});

test("server uploads reject large declared sizes before reading and bound streams without Content-Length", async () => {
  let reads = 0;
  const request = { headers: new Headers(), get body() { reads++; throw new Error("must not read"); } } as unknown as Request;
  await assert.rejects(readSmallUploadBody(request, BigInt(UPLOAD_MAX_BYTES)), (error: any) => error instanceof UploadBodyError && error.status === 413);
  assert.equal(reads, 0);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const streaming = new Request("https://example.test", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readSmallUploadBody(streaming, null), (error: any) => error.status === 413);
  assert.equal(cancelled, true);
  const small = new Request("https://example.test", { method: "PUT", body: new Uint8Array(4) });
  assert.equal((await readSmallUploadBody(small, 4n)).byteLength, 4);
  assert(UPLOAD_SERVER_MAX_BYTES < 4_500_000);
});

test("a retried or concurrent registration returns its one durable document", async () => {
  const existing = { id: "upload_pending-one", title: "Rehearsal", sharingDirtyAt: new Date() };
  const input = {
    uploadId: "pending-one", title: "Rehearsal", categoryId: "scripts", visibility: "BOARD" as const,
    originalFileName: "rehearsal.mov", driveFolderId: null,
    file: { id: "recording", name: "Rehearsal.mov", mimeType: "video/quicktime", webViewLink: "https://example.test", sizeBytes: 3 * 1024 ** 3 },
  };
  let createCount = 0;
  fake.document = {
    findUnique: async () => existing,
    create: async () => { createCount++; throw new Error("must not create"); },
  };
  assert.equal((await documents.recordUploadedDocument({ id: "u" } as any, input)).document.id, existing.id);
  assert.equal(createCount, 0);
  let lookups = 0;
  fake.document.findUnique = async () => ++lookups === 1 ? null : existing;
  fake.document.create = async ({ data }: any) => {
    createCount++;
    assert.equal(data.id, existing.id);
    assert(data.sharingDirtyAt instanceof Date);
    throw Object.assign(new Error("concurrent winner"), { code: "P2002" });
  };
  fake.category = { findUnique: async () => ({ id: "scripts", name: "Scripts", slug: "scripts", companyVisible: true }) };
  fake.orgConfig = { findUnique: async () => ({ id: "singleton", namingTemplate: "{title}" }) };
  assert.equal((await documents.recordUploadedDocument({ id: "u" } as any, input)).document.id, existing.id);
  assert.equal(createCount, 1);
});
