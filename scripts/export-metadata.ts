/**
 * Write everything the hub knows to one JSON file.
 *
 *     npm run backup            # writes backups/hub-<date>.json
 *     npm run backup -- --out /path/to/file.json
 *     npm run backup -- --stdout
 *
 * The files themselves live in Drive and are already backed up by Google; what
 * cannot be recovered from Drive is the *organisation* — which category a file
 * belongs to, who is on the board, which show it was for, who asked for access.
 * That is what this dump holds.
 *
 * Secrets are deliberately left out: the Google and Canva refresh tokens are
 * encrypted with APP_ENCRYPTION_KEY and would be useless in a restore onto a
 * new environment anyway, so the account rows are exported without them and
 * whoever restores reconnects the accounts by hand. That also means this file
 * is safe to keep in a normal Drive folder — it holds names, emails and titles,
 * but no credentials.
 *
 * Pair with scripts/restore-metadata.ts. If you have lost the database *and*
 * the dumps, scripts/rebuild-from-drive.ts reconstructs what it can from the
 * files' own hub labels.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const outFlag = args.indexOf("--out");
const explicitOut = outFlag >= 0 ? args[outFlag + 1] : undefined;

/** The dump format version, so a future restore can migrate an old file. */
const FORMAT = 1;

async function collect() {
  // Ordered the way a restore has to insert them: parents before children.
  const [
    config,
    users,
    categories,
    productions,
    productionRoles,
    productionMembers,
    tags,
    templates,
    documents,
    documentShares,
    accessRequests,
    checklistTemplateItems,
    checklistItems,
    importBatches,
    importItems,
    emailMessages,
    auditLogs,
    driveAccounts,
    canvaAccounts,
  ] = await Promise.all([
    prisma.orgConfig.findUnique({ where: { id: "singleton" } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.production.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.productionRole.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.productionMember.findMany(),
    prisma.tag.findMany(),
    prisma.template.findMany(),
    prisma.document.findMany({
      orderBy: { createdAt: "asc" },
      include: { tags: { select: { id: true } } },
    }),
    prisma.documentShare.findMany(),
    prisma.accessRequest.findMany(),
    prisma.checklistTemplateItem.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.checklistItem.findMany(),
    prisma.importBatch.findMany(),
    prisma.importItem.findMany(),
    prisma.emailMessage.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.driveAccount.findMany(),
    prisma.canvaAccount.findMany(),
  ]);

  // Strip the credentials. Everything else about the account is worth keeping,
  // because it tells whoever restores which account to reconnect.
  const scrub = <T extends { refreshToken: string | null; accessToken: string | null }>(row: T) => {
    const { refreshToken: _refresh, accessToken: _access, ...rest } = row;
    return { ...rest, credentialsOmitted: true };
  };

  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    orgName: config?.orgName ?? "unknown",
    counts: {
      users: users.length,
      documents: documents.length,
      productions: productions.length,
      categories: categories.length,
    },
    config,
    users,
    categories,
    productions,
    productionRoles,
    productionMembers,
    tags,
    templates,
    // Tag links are flattened to ids so a restore can `connect` them.
    documents: documents.map(({ tags: docTags, ...rest }) => ({
      ...rest,
      tagIds: docTags.map((tag) => tag.id),
    })),
    documentShares,
    accessRequests,
    checklistTemplateItems,
    checklistItems,
    importBatches,
    importItems,
    emailMessages,
    auditLogs,
    driveAccounts: driveAccounts.map(scrub),
    canvaAccounts: canvaAccounts.map(scrub),
  };
}

async function main() {
  const dump = await collect();
  const json = JSON.stringify(dump, null, 2);

  if (toStdout) {
    process.stdout.write(json);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const out = explicitOut ?? path.join("backups", `hub-${stamp}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, json, "utf8");

  const kb = Math.max(1, Math.round(json.length / 1024));
  console.log(`Wrote ${out} (${kb} KB)`);
  console.log(
    `  ${dump.counts.documents} documents · ${dump.counts.users} people · ` +
      `${dump.counts.productions} productions · ${dump.counts.categories} categories`,
  );
  console.log("  Google and Canva credentials were left out — reconnect them after a restore.");
  console.log("\nKeep a copy somewhere that is not this machine. To put it back:");
  console.log(`  npm run restore -- ${out} --dry-run`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
