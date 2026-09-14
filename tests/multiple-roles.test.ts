import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Viewer } from "../lib/access";
import { membershipSchema, addCompanyMembersSchema } from "../lib/validation";
import { restoreProductionMember, restoreProductionRole } from "../lib/metadata-restore";

let access: typeof import("../lib/access");
let documents: typeof import("../lib/documents");
let membershipRows: any[] = [];
before(async () => {
  (globalThis as any).prisma = {
    productionMember: { findMany: async () => membershipRows },
  };
  access = await import("../lib/access");
  documents = await import("../lib/documents");
});

const company = { id: "company", email: "company@example.test", role: "COMPANY" };
const role = (id: string, categories: string[], canCreate = false, archived = false) => ({
  roleId: id, role: { id, name: id, categories: categories.map((id) => ({ id })), canCreate, archived },
});
const row = (roles: ReturnType<typeof role>[]) => ({
  production: { id: "show-a", slug: "show-a", name: "Show A" },
  roles, title: "Ensemble", roleId: "legacy-role-that-must-not-be-used",
});

test("multiple roles union viewing categories but creation stays tied to create-enabled role categories", async () => {
  membershipRows = [row([
    role("cast", ["scripts"]),
    role("lighting", ["scripts", "tech"]),
    role("stage-management", ["reports"], true),
    role("archived-role", ["restricted"], true, true),
  ])];
  const viewer = await access.getViewerContext(company);
  assert.deepEqual(viewer.companyCategoryIds.sort(), ["reports", "scripts", "tech"]);
  assert.deepEqual(viewer.memberships[0].creatableCategoryIds, ["reports"]);
  assert.equal(viewer.memberships[0].roles.length, 3);
  assert.equal(viewer.memberships[0].title, "Ensemble");
  assert.equal(access.canCreateDocuments(viewer), true);
  assert.deepEqual(access.creatableCategoryIds(viewer), ["reports"]);
  assert.doesNotThrow(() => documents.assertCreationAllowed(viewer, { categoryId: "reports", productionId: "show-a", visibility: "COMPANY" }));
  assert.doesNotThrow(() => documents.assertCreationAllowed(viewer, { categoryId: "reports", productionId: null, visibility: "COMPANY" }));
  assert.throws(() => documents.assertCreationAllowed(viewer, { categoryId: "scripts", productionId: "show-a", visibility: "COMPANY" }));
  assert.throws(() => documents.assertCreationAllowed(viewer, { categoryId: "tech", productionId: null, visibility: "COMPANY" }));
  assert.throws(() => documents.assertCreationAllowed(viewer, { categoryId: "reports", productionId: "show-b", visibility: "COMPANY" }));
  assert.throws(() => documents.assertCreationAllowed(viewer, { categoryId: "reports", productionId: "show-a", visibility: "BOARD" }));
});

/** Execute the supported access predicate over records to compare list/detail decisions. */
function matches(record: any, where: any): boolean {
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "AND") return condition.every((item: any) => matches(record, item));
    if (key === "OR") return condition.some((item: any) => matches(record, item));
    const value = record[key];
    if (condition === null || typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("some" in condition) return value?.some((item: any) => matches(item, condition.some));
    return matches(value, condition);
  });
}

test("company lists and direct access allow eligible no-show files and enforce membership before creator or named-share access", async () => {
  membershipRows = [row([role("cast", ["scripts"]), role("lighting", ["tech"])])];
  const viewer = await access.getViewerContext(company);
  const base = { categoryId: "scripts", creatorId: "other", visibility: "COMPANY", productionId: null, shares: [] };
  const cases = [
    { doc: base, allowed: true },
    { doc: { ...base, categoryId: "tech" }, allowed: true },
    { doc: { ...base, categoryId: "restricted" }, allowed: false },
    { doc: { ...base, productionId: "show-a" }, allowed: true },
    { doc: { ...base, productionId: "show-b" }, allowed: false },
    { doc: { ...base, productionId: "show-b", creatorId: company.id }, allowed: false },
    { doc: { ...base, productionId: "show-b", visibility: "PRIVATE", shares: [{ userId: company.id }] }, allowed: false },
    { doc: { ...base, productionId: "show-b", visibility: "BOARD", shares: [{ userId: company.id }] }, allowed: false },
    { doc: { ...base, productionId: "show-a", visibility: "PRIVATE", shares: [{ userId: company.id }] }, allowed: true },
    { doc: { ...base, visibility: "PRIVATE" }, allowed: false },
    { doc: { ...base, visibility: "BOARD", creatorId: company.id }, allowed: false },
  ];
  for (const { doc, allowed } of cases) {
    assert.equal(access.canViewDocument(viewer, doc), allowed, JSON.stringify(doc));
    assert.equal(matches(doc, access.visibleDocumentsWhere(viewer)), allowed, `list: ${JSON.stringify(doc)}`);
  }
  const board: Viewer = { ...viewer, role: "BOARD", isBoard: true };
  assert.equal(access.canViewDocument(board, { ...base, productionId: "show-b" }), true);
});

test("removing a role removes just its categories and an empty join never falls back to legacy roleId", async () => {
  membershipRows = [row([role("cast", ["scripts"])])];
  const castOnly = await access.getViewerContext(company);
  assert.deepEqual(castOnly.companyCategoryIds, ["scripts"]);
  assert.equal(access.canCreateDocuments(castOnly), false);
  membershipRows = [row([])];
  const unassigned = await access.getViewerContext(company);
  assert.deepEqual(unassigned.memberships[0].roles, []);
  assert.deepEqual(unassigned.companyCategoryIds, []);
  assert.equal(unassigned.memberships[0].title, "Ensemble");
  assert.equal(access.canViewDocument(unassigned, { creatorId: "other", categoryId: "scripts", visibility: "COMPANY", productionId: "show-a" }), false);
  membershipRows = [];
  const removed = await access.getViewerContext(company);
  assert.equal(access.canViewDocument(removed, { creatorId: company.id, categoryId: "scripts", visibility: "PRIVATE", productionId: "show-a" }), false);
});

test("membership validation permits clearing assignments and deduplicates selected roles", () => {
  assert.deepEqual(membershipSchema.parse({ id: "m", roleIds: [] }).roleIds, []);
  assert.deepEqual(membershipSchema.parse({ id: "m", roleIds: ["cast", "cast", "lighting"] }).roleIds, ["cast", "lighting"]);
  assert.equal(addCompanyMembersSchema.safeParse({ productionId: "show", people: "a@example.test", roleIds: [] }).success, false);
});

test("backup restore preserves multi-role assignments, converts legacy single roles, and respects explicit unassignment", () => {
  const multiple = restoreProductionMember({ id: "m", title: "Ensemble", roleIds: ["cast", "lighting", "cast"] });
  assert.deepEqual(multiple.create.roles.createMany.data, [{ roleId: "cast" }, { roleId: "lighting" }]);
  assert.equal(multiple.create.roleId, null);
  assert.equal((multiple.create as Record<string, unknown>).title, "Ensemble");
  const legacy = restoreProductionMember({ id: "m", roleId: "cast", title: "Ensemble" });
  assert.deepEqual(legacy.create.roles.createMany.data, [{ roleId: "cast" }]);
  const cleared = restoreProductionMember({ id: "m", roleId: "cast", roleIds: [] });
  assert.deepEqual(cleared.create.roles.createMany.data, []);
  assert.deepEqual(cleared.update.roles.deleteMany, { roleId: { notIn: [] } });
  assert.deepEqual(restoreProductionMember({ id: "m", roleId: null }).create.roles.createMany.data, []);
});

test("backup restore restores role-category links while legacy backups preserve unknown existing links", () => {
  assert.deepEqual(restoreProductionRole({ id: "cast", categoryIds: ["scripts"] }).update.categories, { set: [{ id: "scripts" }] });
  assert.deepEqual(restoreProductionRole({ id: "cast", categoryIds: [] }).update.categories, { set: [] });
  assert.equal("categories" in restoreProductionRole({ id: "cast" }).update, false);
});
