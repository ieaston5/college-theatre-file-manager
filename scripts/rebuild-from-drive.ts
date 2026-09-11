/**
 * Rebuild the hub's index from the files themselves.
 *
 *     npm run rebuild                 # report only, writes nothing
 *     npm run rebuild -- --apply
 *     npm run rebuild -- --apply --owner someone@example.com
 *
 * This is the last-resort path: the database is gone and so are the dumps from
 * `npm run backup`, but the Drive folder is intact. Every file the hub has ever
 * created or imported carries its own labels in Drive's appProperties —
 *
 *     hubDocumentId, hubCategory, hubProduction, hubVisibility
 *
 * — so the folder tree is enough to reconstruct which category a file belongs
 * to, which show it was for, and how widely it was shared. That is most of the
 * hub's value back.
 *
 * What cannot come back this way, because Drive never knew it: descriptions
 * written in the hub, tags, per-person shares, who requested access, the
 * activity log, and the company roster. Restore a dump if you have one; use
 * this when you don't.
 *
 * Nothing is destructive. Files already known to the database are left alone,
 * and without --apply the script only reports what it would do.
 */
import type { User } from "@prisma/client";
import { prisma } from "../lib/db";
import { driveProvider, ensureRootFolders, isMockDrive } from "../lib/google";
import { docTypeFromMime, isVisibility, type Visibility } from "../lib/constants";
import { cleanTitle } from "../lib/import";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const ownerFlag = args.indexOf("--owner");
const ownerEmail = ownerFlag >= 0 ? args[ownerFlag + 1]?.toLowerCase() : undefined;

/** Deep enough for <root>/Productions/<Show>/<Category>/<file>, plus slack. */
const MAX_DEPTH = 5;
const MAX_FILES = 2000;

/**
 * The hub's own scaffolding, not anybody's document. Template masters live in
 * Templates and are copied when a document is created — recovering them as
 * documents would file the blanks alongside the real thing.
 */
const SKIP_FOLDERS = new Set(["templates"]);

type Found = {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  size: number | null;
  path: string[];
  props: Record<string, string>;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Walk the hub's folder tree, breadth-first, collecting files. */
async function scan(
  rootId: string,
  rootName: string,
): Promise<{ files: Found[]; folders: number; skipped: number }> {
  const provider = driveProvider();
  const files: Found[] = [];
  let folders = 0;
  let skipped = 0;
  const queue: Array<{ id: string; path: string[]; depth: number }> = [
    { id: rootId, path: [rootName], depth: 0 },
  ];

  while (queue.length > 0 && files.length < MAX_FILES) {
    const current = queue.shift()!;
    const children = await provider.listFolder(current.id);
    for (const child of children) {
      if (child.trashed) continue;
      if (child.mimeType === "application/vnd.google-apps.folder") {
        folders += 1;
        // Only at the top of the tree: a category called "Templates" further
        // down is a real category and should come back.
        if (current.depth === 0 && SKIP_FOLDERS.has(child.name.toLowerCase())) {
          skipped += 1;
          continue;
        }
        if (current.depth < MAX_DEPTH) {
          queue.push({ id: child.id, path: [...current.path, child.name], depth: current.depth + 1 });
        }
        continue;
      }
      files.push({
        fileId: child.id,
        name: child.name,
        mimeType: child.mimeType,
        webViewLink: child.webViewLink ?? null,
        modifiedTime: child.modifiedTime ?? null,
        size: child.sizeBytes ?? null,
        path: current.path,
        props: (child.appProperties ?? {}) as Record<string, string>,
      });
    }
  }

  return { files, folders, skipped };
}

/**
 * Which category a file belongs to.
 *
 * The label wins when it is there. Otherwise the folder it sits in is the next
 * best evidence, because that is how the hub filed it in the first place.
 */
async function resolveCategory(
  file: Found,
  cache: Map<string, string>,
  created: Set<string>,
): Promise<string> {
  const folderName = file.path[file.path.length - 1] ?? "Recovered";
  // The label is the hub's own slug, so it lines up with a category that is
  // still there. Failing that, the folder name is the next best evidence,
  // because the folder is where the hub filed it.
  const slug = file.props.hubCategory || slugify(folderName) || "recovered";

  const cached = cache.get(slug);
  if (cached) return cached;

  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) {
    cache.set(slug, existing.id);
    return existing.id;
  }

  if (!apply) {
    cache.set(slug, `would-create:${slug}`);
    created.add(slug);
    return cache.get(slug)!;
  }

  const category = await prisma.category.create({
    data: {
      name: folderName || "Recovered",
      slug,
      description: "Rebuilt from Drive. Check its sharing defaults before using it.",
      // Deliberately the cautious end of every setting: a rebuilt category
      // should not quietly widen who can see something.
      scope: "BOTH",
      defaultVisibility: "BOARD",
      companyVisible: false,
      defaultEditAccess: "CREATOR_ONLY",
      folderName,
      sortOrder: 900,
    },
  });
  cache.set(slug, category.id);
  created.add(slug);
  return category.id;
}

/** The production a file belongs to, by label, else by its folder path. */
async function resolveProduction(
  file: Found,
  cache: Map<string, string | null>,
  created: Set<string>,
): Promise<string | null> {
  const labelled = file.props.hubProduction;
  // <root>/Productions/<Show>/<Category>/<file>
  const fromPath =
    file.path.length >= 3 && file.path[1] === "Productions" ? file.path[2] : undefined;
  const slug = labelled || (fromPath ? slugify(fromPath) : "");
  if (!slug) return null;

  if (cache.has(slug)) return cache.get(slug)!;

  const existing = await prisma.production.findUnique({ where: { slug } });
  if (existing) {
    cache.set(slug, existing.id);
    return existing.id;
  }

  if (!apply) {
    cache.set(slug, null);
    created.add(slug);
    return null;
  }

  const production = await prisma.production.create({
    data: {
      name: fromPath ?? slug,
      slug,
      // Archived, so a rebuilt show grants nobody company access until an
      // admin has looked at it and re-added the roster deliberately.
      status: "ARCHIVED",
      synopsis: "Rebuilt from Drive. Set its season and status, then re-add the company.",
    },
  });
  cache.set(slug, production.id);
  created.add(slug);
  return production.id;
}

/**
 * Every document needs a creator. In a real rebuild that is whoever is putting
 * the hub back together, so `--owner` creates an admin account if there isn't
 * one yet — on an empty database there is nobody to attribute anything to.
 */
async function pickOwner(): Promise<User> {
  if (ownerEmail) {
    const named = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (named) return named;
    if (!apply) {
      // A dry run should still be able to show the plan, so stand in for the
      // account that --apply would create.
      return {
        id: "would-create",
        email: ownerEmail,
        name: ownerEmail.split("@")[0],
      } as User;
    }
    return prisma.user.create({
      data: { email: ownerEmail, role: "ADMIN", status: "ACTIVE", name: ownerEmail.split("@")[0] },
    });
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (admin) return admin;
  throw new Error(
    "There is no admin account to attribute the rebuilt documents to. " +
      "Sign in once to create one, or pass --owner you@example.com.",
  );
}

async function main() {
  if (isMockDrive()) {
    console.log(
      "DRIVE_MODE is the simulation, so this will rebuild from .mock-drive rather than real Drive.\n",
    );
  }

  const { rootFolderId } = await ensureRootFolders();
  const config = await prisma.orgConfig.findUnique({ where: { id: "singleton" } });
  const owner = await pickOwner();

  console.log(
    `${apply ? "Rebuilding" : "Dry run — nothing will be written."}\n` +
      `  root folder: ${rootFolderId}\n` +
      `  documents will be attributed to: ${owner.email}\n`,
  );

  const { files, folders, skipped } = await scan(rootFolderId, config?.driveRootName ?? "Hub");
  console.log(
    `Walked ${folders} folders and found ${files.length} files` +
      `${skipped > 0 ? ` (the hub's own Templates folder was left out)` : ""}.\n`,
  );

  const known = new Set(
    (
      await prisma.document.findMany({
        where: { googleFileId: { not: null } },
        select: { googleFileId: true },
      })
    ).map((row) => row.googleFileId!),
  );

  const categoryCache = new Map<string, string>();
  const productionCache = new Map<string, string | null>();
  const newCategories = new Set<string>();
  const newProductions = new Set<string>();

  let restored = 0;
  let alreadyKnown = 0;
  let labelled = 0;
  let guessed = 0;
  const failures: string[] = [];
  const samples: string[] = [];

  for (const file of files) {
    if (known.has(file.fileId)) {
      alreadyKnown += 1;
      continue;
    }

    if (file.props.hubDocumentId) labelled += 1;
    else guessed += 1;

    const visibility: Visibility = isVisibility(file.props.hubVisibility)
      ? file.props.hubVisibility
      : "BOARD";

    try {
      const categoryId = await resolveCategory(file, categoryCache, newCategories);
      const productionId = await resolveProduction(file, productionCache, newProductions);
      const title = cleanTitle(file.name);

      if (!apply) {
        if (samples.length < 12) {
          samples.push(
            `  ${title}  →  ${file.props.hubCategory || file.path.at(-1)}` +
              `${file.props.hubProduction ? ` · ${file.props.hubProduction}` : ""}` +
              ` · ${visibility}${file.props.hubDocumentId ? "" : "  (no hub label — guessed)"}`,
          );
        }
        restored += 1;
        continue;
      }

      await prisma.document.create({
        data: {
          // Reuse the original id when Drive still remembers it, so any link
          // anybody has bookmarked keeps working.
          ...(file.props.hubDocumentId ? { id: file.props.hubDocumentId } : {}),
          // The file's name in Drive is already the hub's naming rule applied
          // to something, but what that something was is not recoverable from
          // the name alone — so it stands as both the title and the base the
          // rule would be re-applied to. Re-applying the rule after a rebuild
          // would therefore prefix these a second time; the summary below says
          // so, and an admin can retitle the handful that matter.
          title,
          baseTitle: title,
          description: "Rebuilt from Drive after the hub's database was lost.",
          docType: docTypeFromMime(file.mimeType),
          source: "REGISTERED",
          visibility,
          // The cautious default: a rebuilt document is readable by whoever
          // could see it, and editable by nobody until somebody says so.
          editAccess: "CREATOR_ONLY",
          categoryId,
          productionId,
          creatorId: owner.id,
          googleFileId: file.fileId,
          webViewLink: file.webViewLink,
          mimeType: file.mimeType,
          sizeBytes: file.size,
          originalFileName: file.name,
          googleModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
          lastEditedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
          lastSyncedAt: new Date(),
          ...(file.props.hubCanvaDesignId ? { canvaDesignId: file.props.hubCanvaDesignId } : {}),
        },
      });
      restored += 1;
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(
    `${apply ? "Restored" : "Would restore"} ${restored} document${restored === 1 ? "" : "s"}` +
      ` — ${labelled} carried their hub label, ${guessed} had to be guessed from their folder.`,
  );
  if (alreadyKnown > 0) console.log(`${alreadyKnown} were already in the database and left alone.`);
  if (apply && restored > 0) {
    console.log(
      "Titles were taken from the files' names in Drive, which already follow the hub's naming rule.\n" +
        "Do not run Admin → Settings → “Apply the naming rule” after a rebuild without checking the\n" +
        "preview first: it would compose the rule on top of names that already have it.",
    );
  }
  if (newCategories.size > 0) {
    console.log(
      `${apply ? "Created" : "Would create"} ${newCategories.size} categor${
        newCategories.size === 1 ? "y" : "ies"
      }: ${[...newCategories].join(", ")}`,
    );
  }
  if (newProductions.size > 0) {
    console.log(
      `${apply ? "Created" : "Would create"} ${newProductions.size} production${
        newProductions.size === 1 ? "" : "s"
      }: ${[...newProductions].join(", ")}`,
    );
  }
  if (samples.length > 0) {
    console.log("\nA sample of what would be filed:");
    for (const line of samples) console.log(line);
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} could not be filed:`);
    for (const failure of failures.slice(0, 10)) console.log(`  ${failure}`);
  }

  if (!apply) {
    console.log("\nNothing was written. Add --apply to do it for real.");
    return;
  }

  console.log("\nWhat to do next, in order:");
  console.log("  1. Admin → Categories: check the rebuilt categories' sharing defaults.");
  console.log("  2. Admin → Productions: set each rebuilt show's season and status.");
  console.log("  3. Admin → Members: re-add the board; then re-add each show's company.");
  console.log("  4. Admin → Sharing: run a re-share sweep so Drive matches the hub again.");
  console.log("\nEverything came back as read-only on the Google end, on purpose.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
