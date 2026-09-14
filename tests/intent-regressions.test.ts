import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Viewer } from "../lib/access";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let calls: Array<{ model: string; op: string; args: any }>;
const fake: Record<string, any> = {};
function matches(row: any, where: any): boolean {
  if (!where) return true;
  if (row === undefined || row === null) return where === row;
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "AND") return (Array.isArray(condition) ? condition : [condition]).every((c: any) => matches(row, c));
    if (key === "OR") return condition.some((c: any) => matches(row, c));
    const value = row[key];
    if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition || (value instanceof Date && +value === +condition);
    if ("not" in condition) return typeof condition.not === "object" && condition.not !== null ? !matches({ value }, { value: condition.not }) : value !== condition.not;
    if ("in" in condition) return condition.in.includes(value);
    if ("lt" in condition) return value != null && value < condition.lt;
    if ("gt" in condition) return value != null && value > condition.gt;
    if ("gte" in condition) return value != null && value >= condition.gte;
    if ("some" in condition) return value?.some((v: any) => matches(v, condition.some));
    return matches(value, condition);
  });
}
for (const model of ["orgConfig", "document", "category", "production", "driveAccount", "user", "documentShare", "productionMember", "auditLog", "checklistItem", "checklistTemplateItem"]) {
  fake[model] = {};
  for (const op of ["findUnique", "findFirst", "findMany", "count", "update", "updateMany", "create", "createMany", "groupBy"]) {
    fake[model][op] = async (args: any = {}) => {
      calls.push({ model, op, args });
      const rows = tables[model] ?? [];
      let found = rows.filter(row => matches(row, args.where));
      if (args.orderBy) {
        const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
        found.sort((a, b) => { for (const order of orders) {
          const [key, spec] = Object.entries(order)[0] as [string, any];
          const direction = typeof spec === "string" ? spec : spec.sort;
          if (a[key] == b[key]) continue;
          if (a[key] == null) return -1;
          if (b[key] == null) return 1;
          return (a[key] < b[key] ? -1 : 1) * (direction === "desc" ? -1 : 1);
        } return 0; });
      }
      if (op === "count") return found.length;
      if (op === "findUnique" || op === "findFirst") return structuredClone(found[0] ?? null);
      if (op === "findMany") {
        const offset = args.cursor ? found.findIndex(row => row.id === args.cursor.id) + (args.skip ?? 0) : args.skip ?? 0;
        return structuredClone(found.slice(offset, args.take ? offset + args.take : undefined));
      }
      if (op === "update" || op === "updateMany") {
        for (const row of op === "update" ? found.slice(0, 1) : found) {
          for (const [key, value] of Object.entries(args.data) as [string, any][]) {
            row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
          }
        }
        return op === "update" ? found[0] : { count: found.length };
      }
      if (op === "create" || op === "createMany") {
        const created = Array.isArray(args.data) ? args.data : [args.data];
        rows.push(...created); tables[model] = rows;
        return op === "create" ? created[0] : { count: created.length };
      }
      if (op === "groupBy") {
        const grouped = new Map<string, number>();
        for (const row of found) grouped.set(row.categoryId, (grouped.get(row.categoryId) ?? 0) + 1);
        return [...grouped].map(([categoryId, count]) => ({ categoryId, _count: { _all: count } }));
      }
    };
  }
}
let docs: typeof import("../lib/documents");
let access: typeof import("../lib/access");
let sharing: typeof import("../lib/sharing");
let cron: typeof import("../lib/cron");
let google: typeof import("../lib/google");
let audit: typeof import("../lib/audit");
let checklist: typeof import("../lib/checklist");
let queries: typeof import("../lib/queries");
let Real: typeof import("../lib/google/real").GoogleDriveProvider;
const actor = { id: "owner", email: "owner@example.test", role: "BOARD", status: "ACTIVE" } as any;
const viewer: Viewer = { ...actor, isBoard: true, isAdmin: false, memberships: [], companyCategoryIds: [] };
before(async () => {
  process.env.DRIVE_MODE = "mock";
  (globalThis as any).prisma = fake;
  docs = await import("../lib/documents"); access = await import("../lib/access");
  cron = await import("../lib/cron"); google = await import("../lib/google");
  sharing = await import("../lib/sharing");
  audit = await import("../lib/audit"); checklist = await import("../lib/checklist");
  queries = await import("../lib/queries"); Real = (await import("../lib/google/real")).GoogleDriveProvider;
});
beforeEach(() => {
  calls = [];
  tables = Object.fromEntries(Object.keys(fake).map(model => [model, []]));
  tables.orgConfig = [{ id: "singleton", namingTemplate: "{title}", currentSeason: null, groupEmail: null, sharingSweepStartedAt: null, lastDriveScanAt: new Date("2026-01-01"), driveScanSince: null, driveScanPageToken: null, driveScanStartedAt: null }];
  tables.user = [{ ...actor }];
  tables.category = [{ id: "scripts", name: "Scripts", slug: "scripts", scope: "BOTH", companyVisible: true, archived: false }];
  tables.production = [{ id: "show-a", name: "A", slug: "a", status: "ACTIVE", driveFolderId: "folder-a" }, { id: "show-b", name: "B", slug: "b", status: "ACTIVE", driveFolderId: "folder-b" }];
  tables.driveAccount = [{ id: "singleton", email: "hub@example.test", rootFolderId: "root", productionsFolderId: "productions", standingFolderId: "standing" }];
  tables.document = [{ id: "doc", googleFileId: "file", creatorId: "owner", title: "Script", baseTitle: "Script", categoryId: "scripts", category: tables.category[0], productionId: "show-a", production: tables.production[0], visibility: "COMPANY", source: "CREATED", editAccess: "BOARD", docType: "DOC", status: "ACTIVE", sharingDirtyAt: null, sharingSyncedAt: null, sharingAttemptedAt: null, sharingError: null, managedDrivePermissions: null, sharingVersion: 0, sharingLockToken: null, sharingLockExpiresAt: null, shares: [], createdAt: new Date(), lastEditedAt: new Date() }];
  const provider = google.driveProvider();
  provider.applySharing = async () => ({ granted: [], revoked: [], warnings: [], managedPermissionIds: [] });
  provider.renameFile = provider.moveFile = provider.setAppProperties = async () => {};
  provider.ensureFolder = async () => "folder";
});

test("read-only members cannot create, curate, or edit file contents", () => {
  const member = { ...viewer, role: "MEMBER" };
  assert.equal(access.canCreateDocuments(member), false);
  assert.equal(access.canEditDocument(member, tables.document[0] as any), false);
  assert.equal(access.canEditFileContents(member, tables.document[0] as any), false);
  assert.throws(() => docs.assertCreationAllowed(member, { categoryId: "scripts", visibility: "BOARD" }));
  assert.equal(access.canCreateDocuments(viewer), true);
});

test("re-filing a company document replaces its Drive audience", async () => {
  let received: any;
  google.driveProvider().applySharing = async (_id, plan) => { received = plan; return { granted: [], revoked: [], warnings: [] }; };
  await docs.updateDocument(actor, { id: "doc", title: "Script", categoryId: "scripts", productionId: "show-b", visibility: "COMPANY", editAccess: "BOARD" });
  assert(received);
  assert.equal(tables.document[0].productionId, "show-b");
  assert(tables.orgConfig[0].sharingSweepStartedAt);
});

test("disabled creators and disabled named recipients receive no grants", async () => {
  tables.user[0].status = "DISABLED";
  tables.document[0].visibility = "BOARD";
  tables.documentShare = [{ documentId: "doc", userId: "owner", accessLevel: "WRITER", user: tables.user[0] }];
  let received: any;
  google.driveProvider().applySharing = async (_id, plan) => { received = plan; return { granted: [], revoked: [], warnings: [] }; };
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(received.creatorEmail, null);
  assert.deepEqual(received.extra, []);
});

test("a former board creator does not keep their board document", async () => {
  tables.user[0].role = "COMPANY"; tables.document[0].visibility = "BOARD";
  let received: any;
  google.driveProvider().applySharing = async (_id, plan) => { received = plan; return { granted: [], revoked: [], warnings: [] }; };
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(received.creatorEmail, null);
});

test("closing a category to company access removes that audience", async () => {
  const companyUser = { id: "cast", email: "cast@example.test", role: "COMPANY", status: "ACTIVE" };
  tables.productionMember = [{ productionId: "show-a", status: "ACTIVE", user: companyUser, production: tables.production[0], roles: [{ role: { archived: false, categories: [tables.category[0]] } }] }];
  let received: any;
  google.driveProvider().applySharing = async (_id, plan) => { received = plan; return { granted: [], revoked: [], warnings: [] }; };
  // Avoid returning the company fixture as the creator's own membership.
  tables.user[0].status = "DISABLED";
  await docs.syncSharing(tables.document[0] as any);
  assert(received.extra.some((p: any) => p.email === companyUser.email));
  tables.category[0].companyVisible = false;
  await docs.syncSharing(tables.document[0] as any);
  assert(!received.extra.some((p: any) => p.email === companyUser.email));
});

test("failed permission updates remain pending; a successful retry clears the error", async () => {
  google.driveProvider().applySharing = async () => ({ granted: [], revoked: [], warnings: ["Could not revoke access"] });
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(tables.document[0].sharingSyncedAt, null);
  assert.match(tables.document[0].sharingError, /revoke/);
  assert(tables.orgConfig[0].sharingSweepStartedAt);
  google.driveProvider().applySharing = async () => ({ granted: [], revoked: [], warnings: [] });
  await docs.syncSharing(tables.document[0] as any);
  assert((tables.document[0] as Row).sharingSyncedAt instanceof Date);
  assert.equal(tables.document[0].sharingError, null);
});

test("sweeps revoke access on archived and private files, and keep failures pending", async () => {
  tables.document[0].status = "ARCHIVED"; tables.document[0].visibility = "PRIVATE";
  google.driveProvider().applySharing = async () => ({ granted: [], revoked: [], warnings: ["Temporary failure"] });
  await sharing.queueAllSharing();
  const result = await sharing.drainSharingSlice();
  assert.equal(result.total, 1); assert.equal(result.failures, 1); assert.equal(result.pending, 1);
  const retry = await sharing.drainSharingSlice();
  assert.equal(retry.processed, 0); assert.equal(retry.pending, 1);
});

test("company access updates queue every matching file beyond 500 documents", async () => {
  const prototype = tables.document[0];
  tables.document = Array.from({ length: 501 }, (_, i) => ({ ...prototype, id: String(i).padStart(4, "0"), googleFileId: `file-${i}` }));
  const queued = await sharing.queueCompanySharing({ productionId: "show-a" });
  assert.equal(queued, 501);
  assert.equal((await sharing.sharingProgress()).pending, 501);
});

test("registered files revoke only hub-managed grants and preserve external collaborators", async () => {
  const provider: any = new Real();
  const deleted: string[] = []; const created: any[] = [];
  provider.drive = async () => ({ permissions: {
    list: async ({ pageToken }: any) => pageToken ? { data: { permissions: [{ id: "hub-grant", type: "user", role: "writer", emailAddress: "departed@example.test" }] } } : { data: { nextPageToken: "second", permissions: [{ id: "external-grant", type: "user", role: "writer", emailAddress: "collaborator@example.test" }] } },
    delete: async ({ permissionId }: any) => { deleted.push(permissionId); },
    create: async (args: any) => { created.push(args); return { data: { id: "new-grant" } }; },
  } });
  const result = await provider.applySharing("file", { visibility: "PRIVATE", creatorEmail: null, managedPermissionIds: ["hub-grant"], extra: [], strategy: "additive" });
  assert.deepEqual(deleted, ["hub-grant"]); assert.deepEqual(created, []);
  assert.deepEqual(result.managedPermissionIds, []);
});

test("edit-time scans resume through every page before advancing the watermark", async () => {
  const previous = tables.orgConfig[0].lastDriveScanAt;
  const scanTokens: any[] = [];
  google.driveProvider().listModifiedSince = async (_since, _limit, token) => {
    scanTokens.push(token);
    return token ? { files: [{ id: "file", modifiedTime: "2026-07-01T00:00:00Z" }], nextPageToken: null }
      : { files: [{ id: "other", modifiedTime: "2026-08-01T00:00:00Z" }], nextPageToken: "older-page" };
  };
  await cron.refreshDriveEditTimes({ limit: 1 });
  assert.equal(tables.orgConfig[0].lastDriveScanAt, previous);
  await cron.refreshDriveEditTimes({ limit: 1 });
  assert.deepEqual(scanTokens, [undefined, "older-page"]);
  assert.equal(tables.document[0].lastEditedAt.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(tables.orgConfig[0].driveScanPageToken, null);
});

test("an empty Drive page with a continuation token does not finish the scan", async () => {
  const previous = tables.orgConfig[0].lastDriveScanAt;
  google.driveProvider().listModifiedSince = async () => ({ files: [], nextPageToken: "more-files" });
  await cron.refreshDriveEditTimes();
  assert.equal(tables.orgConfig[0].lastDriveScanAt, previous);
  assert.equal(tables.orgConfig[0].driveScanPageToken, "more-files");
});

test("the existing Drive owner is never re-granted or demoted", async () => {
  const provider: any = new Real();
  provider.drive = async () => ({ permissions: {
    list: async () => ({ data: { permissions: [{ id: "owner-permission", type: "user", role: "owner", emailAddress: actor.email }] } }),
    create: async () => { assert.fail("The owner already has access"); },
    update: async () => { assert.fail("Ownership cannot be narrowed"); },
    delete: async () => { assert.fail("Ownership cannot be removed"); },
  } });
  const result = await provider.applySharing("file", { visibility: "PRIVATE", creatorEmail: actor.email, creatorLevel: "READER", strategy: "additive", extra: [] });
  assert.deepEqual(result.warnings, []);
});

test("automatic audit text never reveals a private Canva title", () => {
  assert(!audit.canvaRefreshSummary({ visibility: "PRIVATE", title: "Secret casting notes" }).includes("Secret"));
  assert(audit.canvaRefreshSummary({ visibility: "BOARD", title: "Poster" }).includes("Poster"));
});

test("filing guide ignores private drafts and old manual approval checkmarks", async () => {
  tables.checklistItem = [{ id: "item", productionId: "show-a", categoryId: "scripts", category: tables.category[0], label: "Approved", done: true, hint: "Approve it" }];
  tables.document[0].visibility = "PRIVATE";
  let entries = await checklist.checklistFor("show-a", viewer);
  assert.equal(entries[0].autoDone, false); assert.equal(entries[0].done, false);
  assert.equal(entries[0].label, "Scripts"); assert.equal(entries[0].hint, null);
  tables.document[0].visibility = "COMPANY";
  entries = await checklist.checklistFor("show-a", viewer);
  assert.equal(entries[0].autoDone, true);
});

test("pagination reaches the last matching document and handles oversized pages", async () => {
  const prototype = tables.document[0];
  tables.document = Array.from({ length: 205 }, (_, i) => ({ ...prototype, id: String(i).padStart(3, "0") }));
  const result = await queries.queryDocuments(viewer, { page: "3" }, { take: 100 });
  assert.equal(result.documents.length, 5); assert.equal(result.documents[4].id, "204");
  assert.equal(result.total, 205);
  assert.equal((await queries.queryDocuments(viewer, { page: "9999999" }, { take: 100 })).page, 3);
});

test("local setup creates PostgreSQL config and secrets without overwriting existing config", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hub-setup-test-"));
  try {
    copyFileSync(path.resolve(".env.example"), path.join(directory, ".env.example"));
    const script = path.resolve("scripts/setup-local.mjs");
    execFileSync(process.execPath, [script], { cwd: directory });
    const contents = readFileSync(path.join(directory, ".env"), "utf8");
    assert(contents.includes('DATABASE_URL="postgresql://'));
    assert(!contents.includes('SESSION_SECRET=""'));
    assert(!contents.includes('APP_ENCRYPTION_KEY=""'));
    execFileSync(process.execPath, [script], { cwd: directory });
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), contents);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("pagination links preserve search and type filters", async () => {
  const React = await import("react");
  (globalThis as any).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { DocumentPagination } = await import("../components/document-pagination");
  const html = renderToStaticMarkup(React.createElement(DocumentPagination, {
    pathname: "/documents", params: { q: "script", type: "PDF" }, page: 2, pageSize: 100, total: 205,
  }));
  assert(html.includes("q=script&amp;type=PDF&amp;page=1"));
  assert(html.includes("q=script&amp;type=PDF&amp;page=3"));
});

test("Canva list shortcuts render a freshness-check button rather than a direct Drive link", async () => {
  const React = await import("react");
  (globalThis as any).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { DocumentRow } = await import("../components/document-items");
  const html = renderToStaticMarkup(React.createElement(DocumentRow, { document: {
    ...tables.document[0], creator: actor, webViewLink: "https://drive.google.com/file/d/example/view", canvaDesignId: "design", docType: "PDF",
  } as any }));
  assert(html.includes("Check Canva and open copy"));
  assert(!html.includes('href="https://drive.google.com'));
});

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const sharingOK = (ids: string[] = []) => ({ granted: [], revoked: [], warnings: [], managedPermissionIds: ids });

test("parallel sharing callers never overlap provider calls or clear a newer request", async () => {
  const entered = gate<void>(); const release = gate<void>();
  let providerCalls = 0;
  google.driveProvider().applySharing = async () => {
    providerCalls += 1; entered.resolve(); await release.promise; return sharingOK();
  };
  const first = docs.syncSharing(tables.document[0] as any);
  await entered.promise;
  const second = await docs.syncSharing(tables.document[0] as any);
  assert.equal(second.deferred, true);
  assert.equal(providerCalls, 1);
  release.resolve();
  assert.equal((await first).deferred, true);
  assert(tables.document[0].sharingDirtyAt);
  assert.equal(tables.document[0].sharingSyncedAt, null);
  assert.equal(tables.document[0].sharingLockToken, null);
  google.driveProvider().applySharing = async () => sharingOK();
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(tables.document[0].sharingDirtyAt, null);
});

test("an audience change during Drive I/O retries from fresh data and preserves new grant IDs", async () => {
  const entered = gate<void>(); const release = gate<void>();
  const staleCaller = structuredClone(tables.document[0]);
  google.driveProvider().applySharing = async () => {
    entered.resolve(); await release.promise; return sharingOK(["old-audience-grant"]);
  };
  const pending = docs.syncSharing(staleCaller as any);
  await entered.promise;
  await fake.document.update({ where: { id: "doc" }, data: { visibility: "PRIVATE" } });
  await sharing.queueDocumentSharing("doc");
  release.resolve();
  assert.equal((await pending).deferred, true);
  assert.deepEqual(JSON.parse(tables.document[0].managedDrivePermissions), ["old-audience-grant"]);
  assert(tables.document[0].sharingDirtyAt);
  google.driveProvider().applySharing = async (_id, plan) => {
    assert.equal(plan.visibility, "PRIVATE");
    assert.deepEqual(plan.managedPermissionIds, ["old-audience-grant"]);
    return { ...sharingOK(), revoked: ["old-audience@example.test"] };
  };
  await docs.syncSharing(staleCaller as any);
  assert.equal(tables.document[0].sharingDirtyAt, null);
  assert.deepEqual(JSON.parse(tables.document[0].managedDrivePermissions), []);
});

test("a late expired lease cannot clear a replacement worker's lease or lose its grants", async () => {
  const firstEntered = gate<void>(); const secondEntered = gate<void>();
  const releaseFirst = gate<void>(); const releaseSecond = gate<void>();
  let count = 0;
  google.driveProvider().applySharing = async () => {
    count += 1;
    if (count === 1) { firstEntered.resolve(); await releaseFirst.promise; return sharingOK(["late-grant"]); }
    secondEntered.resolve(); await releaseSecond.promise; return sharingOK(["new-grant"]);
  };
  const first = docs.syncSharing(tables.document[0] as any);
  await firstEntered.promise;
  tables.document[0].sharingLockExpiresAt = new Date(0);
  const second = docs.syncSharing(tables.document[0] as any);
  await secondEntered.promise;
  const replacementToken = tables.document[0].sharingLockToken;
  releaseFirst.resolve();
  assert.equal((await first).deferred, true);
  assert.equal(tables.document[0].sharingLockToken, replacementToken);
  releaseSecond.resolve();
  assert.equal((await second).deferred, true);
  assert.deepEqual(JSON.parse(tables.document[0].managedDrivePermissions).sort(), ["late-grant", "new-grant"]);
  assert(tables.document[0].sharingDirtyAt);
  assert.equal(tables.document[0].sharingSyncedAt, null);
  google.driveProvider().applySharing = async (_id, plan) => {
    assert.deepEqual(plan.managedPermissionIds?.sort(), ["late-grant", "new-grant"]);
    return sharingOK();
  };
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(tables.document[0].sharingDirtyAt, null);
});

test("a late expired worker requeues even after a newer worker finished successfully", async () => {
  const entered = gate<void>(); const release = gate<void>();
  let count = 0;
  google.driveProvider().applySharing = async () => {
    if (++count === 1) { entered.resolve(); await release.promise; return sharingOK(["late-grant"]); }
    return sharingOK(["current-grant"]);
  };
  const first = docs.syncSharing(tables.document[0] as any);
  await entered.promise;
  tables.document[0].sharingLockExpiresAt = new Date(0);
  await docs.syncSharing(tables.document[0] as any);
  assert.equal(tables.document[0].sharingDirtyAt, null);
  release.resolve();
  assert.equal((await first).deferred, true);
  assert(tables.document[0].sharingDirtyAt);
  assert.deepEqual(JSON.parse(tables.document[0].managedDrivePermissions).sort(), ["current-grant", "late-grant"]);
});

test("external edit grants are preserved but reported when the hub requests read-only", async () => {
  const provider: any = new Real();
  provider.drive = async () => ({ permissions: {
    list: async () => ({ data: { permissions: [{ id: "external", type: "user", role: "writer", emailAddress: "reader@example.test" }] } }),
    create: async () => assert.fail("An existing external grant must not be claimed"),
    update: async () => assert.fail("The owner's grant must not be changed"),
    delete: async () => assert.fail("The owner's grant must not be removed"),
  } });
  const result = await provider.applySharing("file", { visibility: "COMPANY", creatorEmail: null, strategy: "additive", extra: [{ email: "reader@example.test", level: "READER" }] });
  assert.match(result.warnings.join(" "), /existing edit access.*managed outside the hub/);
  assert.deepEqual(result.managedPermissionIds, []);
  assert.equal(result.granted[0].level, "WRITER");
});

test("membership changes queue private creators and named shares as well as company files", async () => {
  const base = tables.document[0];
  tables.document = [
    { ...base, id: "private", visibility: "PRIVATE" },
    { ...base, id: "board", visibility: "BOARD" },
    { ...base, id: "org", visibility: "COMPANY", productionId: null },
    { ...base, id: "other", productionId: "show-b" },
  ];
  assert.equal(await sharing.queueCompanySharing({ productionId: "show-a", urgent: true }), 3);
  assert(tables.document.slice(0, 3).every(doc => doc.sharingDirtyAt && doc.sharingVersion === 1));
  assert.equal(tables.document[3].sharingDirtyAt, null);
});

for (const role of ["writer", "organizer", "fileOrganizer"]) {
  for (const strategy of ["additive", "reconcile"] as const) {
    test(`${strategy} sharing reports inherited ${role} access honestly`, async () => {
      const provider: any = new Real();
      provider.drive = async () => ({ permissions: {
        list: async () => ({ data: { permissions: [{ id: "inherited", type: "user", role, emailAddress: "reader@example.test", permissionDetails: [{ inherited: true }] }] } }),
        create: async () => assert.fail("Inherited access already satisfies the requested grant"),
        update: async () => assert.fail("An inherited grant cannot be narrowed here"),
        delete: async () => assert.fail("An inherited grant cannot be removed here"),
      } });
      const plan = { visibility: "COMPANY", creatorEmail: null, strategy, extra: [{ email: "reader@example.test", level: "READER" }] };
      const result = await provider.applySharing("file", plan);
      assert.equal(result.warnings.length, 1);
      assert.equal(result.granted[0].level, "WRITER");
      assert.deepEqual(result.managedPermissionIds, []);
      const writerResult = await provider.applySharing("file", { ...plan, extra: [{ email: "reader@example.test", level: "WRITER" }] });
      assert.deepEqual(writerResult.warnings, []);
      assert.equal(writerResult.granted[0].level, "WRITER");
    });
  }
}
