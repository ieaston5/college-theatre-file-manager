/**
 * Real HTTP + PostgreSQL checks, intentionally excluded from the unit-test glob.
 * Run against an isolated, migrated local mock-Drive server only:
 * UPLOAD_TEST_BASE_URL=http://127.0.0.1:3139 TEST_DATABASE_URL=postgresql://.../hub_final_test
 * UPLOAD_TEST_SESSION_SECRET=<same isolated server secret> node --import tsx --test tests/integration/upload-endpoints.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SignJWT } from "jose";

test("authenticated upload endpoints verify size, recover registration, and remain idempotent under concurrent retries", async () => {
  const base = new URL(process.env.UPLOAD_TEST_BASE_URL ?? "invalid:");
  const database = new URL(process.env.TEST_DATABASE_URL ?? "invalid:");
  const secret = process.env.UPLOAD_TEST_SESSION_SECRET;
  assert(["localhost", "127.0.0.1"].includes(base.hostname), "Use an isolated local mock-Drive app");
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && /test/i.test(database.pathname), "Use an isolated local test database");
  assert(secret, "Supply the isolated app's session secret");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString(), max: 1 }) });
  const prefix = `upload-verification-${randomUUID()}`;
  const ownerId = `${prefix}-owner`, strangerId = `${prefix}-stranger`;
  const categoryId = `${prefix}-category`;
  const uploads: string[] = [];
  try {
    await db.user.createMany({ data: [
      { id: ownerId, email: `${ownerId}@example.test`, role: "ADMIN", status: "ACTIVE" },
      { id: strangerId, email: `${strangerId}@example.test`, role: "ADMIN", status: "ACTIVE" },
    ] });
    await db.category.create({ data: { id: categoryId, name: "Upload endpoint test", slug: categoryId, scope: "BOTH", companyVisible: true } });
    const cookie = async (id: string) => `pph_session=${await new SignJWT({ uid: id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret))}`;
    const ownerCookie = await cookie(ownerId), strangerCookie = await cookie(strangerId);
    const post = async (path: string, body: object, auth: string | null = ownerCookie) => {
      const response = await fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Cookie: auth } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    };
    const start = async () => {
      const response = await post("/api/uploads/start", { mode: "new", title: "Rehearsal endpoint verification", categoryId, visibility: "BOARD", fileName: "rehearsal.mp4", mimeType: "video/mp4", sizeBytes: 6 });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.kind, "direct", "This check only sends bytes to simulated Drive");
      assert.match(response.body.uploadUrl, /^\/api\/uploads\/mock\?/);
      uploads.push(response.body.uploadId);
      return response.body;
    };
    const plan = await start();
    assert.equal((await post("/api/uploads/status", { uploadId: plan.uploadId }, null)).status, 401);
    assert.equal((await post("/api/uploads/status", { uploadId: plan.uploadId }, strangerCookie)).status, 404);
    assert.equal((await post("/api/uploads/finish", { uploadId: plan.uploadId }, strangerCookie)).status, 403);
    const put = await fetch(new URL(plan.uploadUrl, base), { method: "PUT", headers: { Cookie: ownerCookie }, body: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    assert.equal(put.status, 200);
    const { fileId } = await put.json() as { fileId: string };
    await db.pendingUpload.update({ where: { id: plan.uploadId }, data: { sizeBytes: 3n * 1024n ** 3n } });
    const mismatch = await post("/api/uploads/finish", { uploadId: plan.uploadId, fileId });
    assert.equal(mismatch.status, 409);
    assert.match(mismatch.body.error, /size does not match/);
    assert.equal((await db.pendingUpload.findUniqueOrThrow({ where: { id: plan.uploadId } })).status, "PENDING");
    assert.equal(await db.document.count({ where: { creatorId: ownerId } }), 0);
    await db.pendingUpload.update({ where: { id: plan.uploadId }, data: { sizeBytes: 6n } });
    const finishes = await Promise.all(Array.from({ length: 4 }, () => post("/api/uploads/finish", { uploadId: plan.uploadId, fileId })));
    for (const result of finishes) assert.equal(result.status, 200, JSON.stringify(result.body));
    const documentId = finishes[0].body.documentId;
    assert.equal(documentId, `upload_${plan.uploadId}`);
    assert(finishes.every(result => result.body.documentId === documentId));
    assert.equal(await db.document.count({ where: { creatorId: ownerId } }), 1);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: documentId } })).sizeBytes, 6n);
    assert.equal((await post("/api/uploads/finish", { uploadId: plan.uploadId })).body.documentId, documentId);
    // Emulate losing the process after the document insert, before pending completion.
    await db.pendingUpload.update({ where: { id: plan.uploadId }, data: { status: "PENDING", documentId: null } });
    const recovered = await post("/api/uploads/finish", { uploadId: plan.uploadId, fileId });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.documentId, documentId);
    assert.equal(await db.document.count({ where: { creatorId: ownerId } }), 1);
    // Recovering an existing row must check its current access, not just the
    // old filing details captured when the upload started.
    await db.pendingUpload.update({ where: { id: plan.uploadId }, data: { status: "PENDING", documentId: null } });
    await db.document.update({ where: { id: documentId }, data: { visibility: "PRIVATE", creatorId: strangerId } });
    assert.equal((await post("/api/uploads/finish", { uploadId: plan.uploadId, fileId })).status, 403);
    await db.document.update({ where: { id: documentId }, data: { visibility: "BOARD", creatorId: ownerId } });
    assert.equal((await post("/api/uploads/finish", { uploadId: plan.uploadId, fileId })).status, 200);
    const unfinished = await start();
    await db.user.update({ where: { id: ownerId }, data: { role: "COMPANY" } });
    assert.equal((await post("/api/uploads/finish", { uploadId: plan.uploadId })).status, 403);
    assert.equal((await post("/api/uploads/status", { uploadId: unfinished.uploadId })).status, 403);
  } finally {
    await db.pendingUpload.deleteMany({ where: { id: { in: uploads } } });
    await db.document.deleteMany({ where: { creatorId: { in: [ownerId, strangerId] } } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.auditLog.deleteMany({ where: { actorId: { in: [ownerId, strangerId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    await db.$disconnect();
  }
});
