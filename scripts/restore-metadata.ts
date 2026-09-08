/**
 * Put a dump from scripts/export-metadata.ts back into the database.
 *
 *     npm run restore -- backups/hub-2026-09-08-12-00-00.json --dry-run
 *     npm run restore -- backups/hub-2026-09-08-12-00-00.json
 *
 * Rows are upserted by id, in dependency order, so this is safe to run against
 * an empty database (the normal case: a new host, a new Postgres) and also
 * against a live one, where it repairs what is missing and leaves everything
 * else as it is. Nothing is deleted — a restore never removes a document
 * somebody has filed since the dump was taken.
 *
 * What it does not restore: the Google and Canva refresh tokens, which are not
 * in the dump. Reconnect both from Admin → Google connection afterwards. Until
 * then the hub runs in its simulated mode and files nothing to Drive.
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../lib/db";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!file) {
  console.error("Usage: npm run restore -- <dump.json> [--dry-run]");
  process.exit(1);
}

/** Dates come back from JSON as strings; Prisma wants Date objects. */
function revive<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)
        ? new Date(value)
        : value;
  }
  return out as T;
}

type AnyRow = Record<string, unknown> & { id: string };

/**
 * One table. `delegate` is the Prisma model; rows are upserted by id and
 * failures are collected rather than thrown, so one bad row cannot abandon the
 * rest of a restore halfway through.
 *
 * `shape` exists because Prisma's create and update take different shapes for
 * many-to-many relations — `connect` on the way in, `set` afterwards — so a
 * table with tags cannot hand the same object to both halves of an upsert.
 */
async function restoreTable(
  label: string,
  rows: AnyRow[] | undefined,
  // The Prisma delegates have no common supertype, so this is the one place
  // the script gives up on types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any,
  shape?: (row: AnyRow) => {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  },
): Promise<void> {
  if (!rows || rows.length === 0) {
    console.log(`  ${label}: nothing in the dump`);
    return;
  }
  if (dryRun) {
    console.log(`  ${label}: would restore ${rows.length}`);
    return;
  }

  let done = 0;
  const failures: string[] = [];
  for (const raw of rows) {
    const revived = revive(raw);
    const { create, update } = shape
      ? shape(revived)
      : { create: revived, update: revived };
    try {
      await delegate.upsert({ where: { id: raw.id }, create, update });
      done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n").at(-1) : String(error);
      failures.push(`${raw.id}: ${message?.trim()}`);
    }
  }

  console.log(`  ${label}: ${done}/${rows.length}`);
  for (const failure of failures.slice(0, 5)) console.log(`      skipped ${failure}`);
  if (failures.length > 5) console.log(`      …and ${failures.length - 5} more`);
}

async function main() {
  const dump = JSON.parse(await readFile(file!, "utf8"));
  if (dump.format !== 1) {
    throw new Error(`This dump says format ${dump.format}; this script understands format 1.`);
  }

  console.log(
    `${dryRun ? "Dry run — nothing will be written." : "Restoring"} ${file}` +
      `\n  taken ${dump.exportedAt} from “${dump.orgName}”\n`,
  );

  // Parents first. Documents reference categories, productions, users and
  // templates; shares and checklists reference documents.
  if (dump.config && !dryRun) {
    const { id: _id, ...config } = revive(dump.config);
    await prisma.orgConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...config },
      update: config,
    });
    console.log("  settings: restored");
  } else if (dump.config) {
    console.log("  settings: would restore");
  }

  await restoreTable("people", dump.users, prisma.user);
  await restoreTable("categories", dump.categories, prisma.category);
  await restoreTable("productions", dump.productions, prisma.production);
  await restoreTable("production roles", dump.productionRoles, prisma.productionRole);
  await restoreTable("company members", dump.productionMembers, prisma.productionMember);
  await restoreTable("tags", dump.tags, prisma.tag);
  await restoreTable("templates", dump.templates, prisma.template);

  await restoreTable("documents", dump.documents, prisma.document, (row) => {
    const { tagIds, ...rest } = row as AnyRow & { tagIds?: string[] };
    const links = (tagIds ?? []).map((id) => ({ id }));
    return {
      create: { ...rest, ...(links.length > 0 ? { tags: { connect: links } } : {}) },
      update: { ...rest, tags: { set: links } },
    };
  });

  await restoreTable("shares", dump.documentShares, prisma.documentShare);
  await restoreTable("access requests", dump.accessRequests, prisma.accessRequest);
  await restoreTable(
    "checklist templates",
    dump.checklistTemplateItems,
    prisma.checklistTemplateItem,
  );
  await restoreTable("checklists", dump.checklistItems, prisma.checklistItem);
  await restoreTable("import batches", dump.importBatches, prisma.importBatch);
  await restoreTable("import items", dump.importItems, prisma.importItem);
  await restoreTable("email log", dump.emailMessages, prisma.emailMessage);
  await restoreTable("activity log", dump.auditLogs, prisma.auditLog);

  // The account rows carry no credentials, so they are restored as a reminder
  // of which account to reconnect rather than as working connections.
  const withoutCredentials = (row: AnyRow) => {
    const { credentialsOmitted: _omitted, ...rest } = row;
    const data = { ...rest, refreshToken: null, accessToken: null, expiresAt: null };
    return { create: data, update: data };
  };
  await restoreTable("google account", dump.driveAccounts, prisma.driveAccount, withoutCredentials);
  await restoreTable("canva account", dump.canvaAccounts, prisma.canvaAccount, withoutCredentials);

  if (dryRun) {
    console.log("\nNothing was written. Run the same command without --dry-run to apply it.");
    return;
  }

  console.log("\nDone. Two things are still missing on purpose:");
  console.log("  1. Reconnect Google in Admin → Google connection (the dump holds no tokens).");
  console.log("  2. Reconnect Canva there too, if you use it.");
  console.log("Then open Admin → Sharing and run a re-share sweep so Drive matches the hub again.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
