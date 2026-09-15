/** Run against the same isolated local app/database as upload-endpoints.ts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SignJWT } from "jose";

test("the same signed-in session loses board files in categories, search, details, and sync status", async () => {
  const base = new URL(process.env.UPLOAD_TEST_BASE_URL ?? "invalid:");
  const database = new URL(process.env.TEST_DATABASE_URL ?? "invalid:");
  const secret = process.env.UPLOAD_TEST_SESSION_SECRET;
  assert(["localhost", "127.0.0.1"].includes(base.hostname));
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && /test/i.test(database.pathname));
  assert(secret);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString(), max: 1 }) });
  const id = `access-${randomUUID()}`;
  const boardTitle = `Board-confidential-${id}`;
  const companyTitle = `Company-visible-${id}`;
  try {
    await db.user.create({ data: { id, email: `${id}@example.test`, role: "BOARD", status: "ACTIVE" } });
    await db.category.create({ data: { id, slug: id, name: id, scope: "BOTH", companyVisible: true, defaultVisibility: "COMPANY" } });
    await db.production.create({ data: { id, slug: id, name: id, status: "ACTIVE" } });
    await db.productionRole.create({ data: { id, slug: id, name: id, categories: { connect: { id } } } });
    await db.productionMember.create({ data: { userId: id, productionId: id, roles: { create: { roleId: id } } } });
    await db.document.createMany({ data: [
      { id: `${id}-board`, title: boardTitle, baseTitle: boardTitle, docType: "LINK", creatorId: id, categoryId: id, productionId: id, visibility: "BOARD" },
      { id: `${id}-company`, title: companyTitle, baseTitle: companyTitle, docType: "LINK", creatorId: id, categoryId: id, productionId: id, visibility: "COMPANY" },
    ] });
    // A historical explicit grant must not bypass the later board removal.
    await db.documentShare.create({ data: { documentId: `${id}-board`, userId: id, grantedById: id } });
    const token = await new SignJWT({ uid: id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    const get = (path: string) => fetch(new URL(path, base), { headers: { Cookie: `pph_session=${token}` }, cache: "no-store" });
    const before = await (await get(`/categories/${id}`)).text();
    assert(before.includes(boardTitle));
    assert.match(before.replace(/<!--.*?-->/g, ""), /Defaults to company/);
    assert.equal((await get(`/api/documents/${id}-board/sync-status`)).status, 200);
    await db.user.update({ where: { id }, data: { role: "COMPANY" } });
    const after = await (await get(`/categories/${id}`)).text();
    assert(!after.includes(boardTitle));
    assert(after.includes(companyTitle));
    assert(!(await (await get(`/documents?q=${encodeURIComponent(boardTitle)}`)).text()).includes(`>${boardTitle}<`));
    const detail = await (await get(`/documents/${id}-board`)).text();
    assert(detail.includes("You do not have access to this"));
    if (process.env.ASSERT_PRODUCTION_HTML === "true") assert(!detail.includes(boardTitle));
    // Next dev embeds resolved server values in its React debug payload. Check
    // rendered content here; production builds omit that development payload.
    assert(!detail.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").includes(boardTitle));
    assert.equal((await get(`/api/documents/${id}-board/sync-status`)).status, 404);
    assert.equal((await get("/api/sharing/progress")).status, 403);
    assert.equal((await get(`/api/documents/${id}-company/sync-status`)).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id } })).role, "COMPANY");
  } finally {
    await db.document.deleteMany({ where: { categoryId: id } });
    await db.production.deleteMany({ where: { id } });
    await db.productionRole.deleteMany({ where: { id } });
    await db.category.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
