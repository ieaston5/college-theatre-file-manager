import type { Category, Production, User } from "@prisma/client";
import { prisma } from "./db";
import { driveProvider } from "./google";
import { docTypeFromMime, type Visibility } from "./constants";
import { recordAudit } from "./audit";
import { documentName, syncSharing } from "./documents";
import { getConfig } from "./config";
import { driveViewLink, withExtension } from "./utils";

/**
 * Bringing the existing pile in.
 *
 * The club's information already exists — in spreadsheets scattered across
 * several people's Drives. Nothing else in the hub matters if that pile never
 * arrives, so this scans a folder, guesses where each file belongs, and lets
 * somebody confirm a screenful at a time rather than filling in a form per
 * file.
 *
 * Guessing is deliberately cheap and explainable: filename words against the
 * category keywords an admin can edit, plus show names and abbreviations. It
 * gets most files right, and a human always confirms.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const MAX_DEPTH = 4;
const MAX_FILES = 400;
/** How many per-file failures the activity log keeps verbatim. */
const MAX_LOGGED_FAILURES = 50;

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,12}$/, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

type Guess = { categoryId?: string; productionId?: string; confidence: number };

/**
 * A word in the filename is much stronger evidence than the same word in an
 * enclosing folder name: "board stuff / iron gate space request form" belongs
 * to Venue, not to Board & governance, even though "board" is right there in
 * the path.
 */
const SCORE = { filePhrase: 4, pathPhrase: 2, fileWord: 3, pathWord: 1 };

export function guessPlacement(
  fileName: string,
  folderPath: string,
  categories: Array<Pick<Category, "id" | "name" | "keywords">>,
  productions: Array<Pick<Production, "id" | "name" | "abbreviation" | "season">>,
): Guess {
  const fileHay = fileName.toLowerCase();
  const pathHay = folderPath.toLowerCase();
  const fileWords = new Set(words(fileName));
  const pathWords = new Set(words(folderPath));

  const scoreTerm = (term: string): number => {
    if (!term) return 0;
    if (term.includes(" ")) {
      if (fileHay.includes(term)) return SCORE.filePhrase;
      if (pathHay.includes(term)) return SCORE.pathPhrase;
      return 0;
    }
    if (fileWords.has(term)) return SCORE.fileWord;
    if (pathWords.has(term)) return SCORE.pathWord;
    return 0;
  };

  let bestCategory: { id: string; score: number } | null = null;
  for (const category of categories) {
    // Deduplicated: a category called "Board & governance" with "board" in its
    // keywords must not score that word twice.
    const terms = new Set([
      ...words(category.name),
      ...(category.keywords ?? "")
        .split(",")
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    ]);

    let score = 0;
    for (const term of terms) score += scoreTerm(term);
    if (score > (bestCategory?.score ?? 0)) bestCategory = { id: category.id, score };
  }

  let bestProduction: { id: string; score: number } | null = null;
  for (const production of productions) {
    const terms = new Set(
      [production.name, production.abbreviation]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    );

    let score = 0;
    for (const term of terms) {
      const squashed = term.replace(/[^a-z0-9]/g, "");
      if (fileHay.includes(term)) score = Math.max(score, 5);
      else if (squashed.length > 3 && fileHay.replace(/[^a-z0-9]/g, "").includes(squashed)) {
        score = Math.max(score, 4);
      } else if (pathHay.includes(term)) score = Math.max(score, 3);
      else if (squashed.length > 3 && pathHay.replace(/[^a-z0-9]/g, "").includes(squashed)) {
        score = Math.max(score, 2);
      }
    }
    if (score > (bestProduction?.score ?? 0)) bestProduction = { id: production.id, score };
  }

  const raw = (bestCategory?.score ?? 0) * 11 + (bestProduction?.score ?? 0) * 6;
  return {
    categoryId: bestCategory && bestCategory.score > 0 ? bestCategory.id : undefined,
    productionId: bestProduction && bestProduction.score > 0 ? bestProduction.id : undefined,
    confidence: Math.min(100, raw),
  };
}

export type ScanResult = {
  batchId: string;
  found: number;
  duplicates: number;
  skippedFolders: number;
  /**
   * Files the walk reached but could not record, as `name: reason`.
   *
   * One unrecordable file used to end the scan: a file whose size overflowed
   * the column threw out of the loop, and a folder of several hundred files
   * produced a batch nobody could use. A scan that skips one file and says
   * which is worth far more than a scan that stops, so failures are collected
   * and reported rather than thrown.
   */
  failures: string[];
  /**
   * What Drive actually returned, so "nothing to import" can say why.
   *
   * A scan that finds nothing has several quite different causes — an empty
   * folder, a folder full of subfolders with the box unticked, a folder this
   * account may see but not enumerate, a shortcut rather than the folder
   * itself — and they are indistinguishable from the outside.
   */
  diagnostics: {
    entriesReturned: number;
    subfolders: number;
    shortcuts: number;
    /** Shortcuts whose target the hub could read, and therefore imported. */
    shortcutsFollowed: number;
    /** Shortcuts whose target is not shared with the hub account. */
    shortcutsUnreadable: number;
    foldersVisited: number;
    /** Subfolders below the depth limit, which were not looked in. */
    notLookedIn: string[];
    /**
     * Files that came out of a shared drive. Those need no ownership
     * handover — the drive owns them, so the club already does — which is
     * worth saying, because Drive reports them as having no owner at all and
     * that otherwise reads as "the hub could not tell".
     */
    sharedDriveFiles: number;
    /** Names of the shared drives the scan drew from. */
    sharedDriveNames: string[];
  };
};

/** Walk a Drive folder and record everything worth filing. */
export async function scanDriveFolder(
  actor: User,
  options: {
    folderId: string;
    folderName?: string | null;
    includeSubfolders: boolean;
    /** The shared drive the starting folder lives in, when it lives in one. */
    driveId?: string | null;
  },
): Promise<ScanResult> {
  const provider = driveProvider();

  /**
   * Never write simulated files into a real database.
   *
   * This is here because it happened: a scan run against the simulated Drive,
   * with DATABASE_URL pointed at the club's deployed Postgres, filed 174
   * invented files — rehearsal reports for a show they had never staged —
   * into their import queue. They were indistinguishable from real findings
   * until you clicked one and Google returned 404.
   *
   * The simulation exists for a laptop with a laptop's database. Anything
   * else is a mistake worth refusing rather than explaining afterwards.
   */
  if (provider.mode === "mock" && !(process.env.DATABASE_URL ?? "").startsWith("file:")) {
    throw new Error(
      "Refusing to scan: the Drive is simulated but the database is not local, " +
        "so this would file invented files into a real hub. Point DATABASE_URL at a local " +
        "database, or set DRIVE_MODE=google.",
    );
  }
  const [categories, productions] = await Promise.all([
    prisma.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, keywords: true },
    }),
    prisma.production.findMany({
      select: { id: true, name: true, abbreviation: true, season: true },
    }),
  ]);

  const batch = await prisma.importBatch.create({
    data: {
      sourceFolderId: options.folderId,
      sourceFolderName: options.folderName ?? null,
      includeSubfolders: options.includeSubfolders,
      startedById: actor.id,
    },
  });

  let found = 0;
  let duplicates = 0;
  let skippedFolders = 0;
  let entriesReturned = 0;
  let shortcuts = 0;
  let shortcutsFollowed = 0;
  let shortcutsUnreadable = 0;
  let foldersVisited = 0;
  let sharedDriveFiles = 0;
  const tooDeep: string[] = [];
  const sharedDrivesSeen = new Set<string>();
  const failures: string[] = [];

  /**
   * Shared drive names, so an imported file can say which drive it came out
   * of rather than showing a bare id.
   *
   * Fetched once, on the first file that needs one, and never for a scan that
   * only touches My Drive. A folder of shortcuts can reach into several
   * drives at once, which is why this is the whole list rather than a lookup
   * per file.
   */
  const driveNames = new Map<string, string>();
  let driveNamesLoaded = false;
  const driveNameFor = async (driveId: string): Promise<string | null> => {
    if (!driveNamesLoaded) {
      driveNamesLoaded = true;
      for (const drive of await provider.listSharedDrives().catch(() => [])) {
        driveNames.set(drive.id, drive.name);
      }
    }
    return driveNames.get(driveId) ?? null;
  };

  const queue: Array<{ id: string; path: string; depth: number; driveId: string | null }> = [
    {
      id: options.folderId,
      path: options.folderName ?? "",
      depth: 0,
      driveId: options.driveId ?? null,
    },
  ];

  while (queue.length > 0 && found < MAX_FILES) {
    const folder = queue.shift()!;
    const entries = await provider.listFolder(folder.id, { driveId: folder.driveId });
    foldersVisited += 1;
    entriesReturned += entries.length;

    for (const listed of entries) {
      if (found >= MAX_FILES) break;

      /**
       * Resolve shortcuts to what they point at.
       *
       * Drive has not allowed a file to have two parents since 2020: adding
       * somebody else's file to your own folder creates a shortcut instead. So
       * a folder assembled *for* an import is very often a folder of
       * shortcuts, and the previous behaviour — skip them, on the theory that
       * the real file would be scanned from wherever it lives — meant a
       * carefully prepared folder scanned as empty.
       */
      let entry = listed;
      if (listed.mimeType === SHORTCUT_MIME) {
        shortcuts += 1;
        const targetId = listed.shortcutTargetId;
        const target = targetId ? await provider.getFile(targetId) : null;
        if (!target) {
          // The shortcut is readable but its target is not shared with the
          // hub, which is worth saying rather than skipping in silence.
          shortcutsUnreadable += 1;
          continue;
        }
        shortcutsFollowed += 1;
        // Keep the target's own name and id: that is the file being filed.
        entry = target;
      }

      if (entry.mimeType === FOLDER_MIME) {
        skippedFolders += 1;
        if (options.includeSubfolders && folder.depth < MAX_DEPTH) {
          queue.push({
            id: entry.id,
            path: folder.path ? `${folder.path} / ${entry.name}` : entry.name,
            depth: folder.depth + 1,
            // Following a shortcut can cross from My Drive into a shared
            // drive, or between two of them, so the drive is taken from the
            // subfolder rather than inherited from its parent.
            driveId: entry.driveId ?? null,
          });
        } else if (options.includeSubfolders) {
          // Deeper than the walk goes. Counted, because an import that
          // quietly stopped four levels down would look complete.
          tooDeep.push(folder.path ? `${folder.path} / ${entry.name}` : entry.name);
        }
        continue;
      }

      /**
       * One file per failure, never the batch.
       *
       * Everything in here can fail for reasons particular to a single file —
       * a size Postgres will not take in an Int, a name the database rejects,
       * a transient read — and none of them say anything about the hundreds of
       * files after it. So the file is named, the reason kept, and the walk
       * carries on.
       */
      try {
        const alreadyOnHub = await prisma.document.findUnique({
          where: { googleFileId: entry.id },
          select: { id: true },
        });

        const guess = alreadyOnHub
          ? { confidence: 0 }
          : guessPlacement(entry.name, folder.path, categories, productions);

        const driveId = entry.driveId ?? null;
        const driveName = driveId ? await driveNameFor(driveId) : null;
        if (driveId) {
          sharedDriveFiles += 1;
          sharedDrivesSeen.add(driveName ?? driveId);
        }

        await prisma.importItem.upsert({
          where: { batchId_googleFileId: { batchId: batch.id, googleFileId: entry.id } },
          create: {
            batchId: batch.id,
            googleFileId: entry.id,
            name: entry.name,
            mimeType: entry.mimeType,
            ownerEmail: entry.ownerEmail ?? null,
            driveId,
            driveName,
            webViewLink:
              entry.webViewLink || driveViewLink(entry.id, docTypeFromMime(entry.mimeType)),
            folderPath: folder.path || null,
            sizeBytes: entry.sizeBytes ?? null,
            modifiedAt: entry.modifiedTime ? new Date(entry.modifiedTime) : null,
            guessedCategoryId: guess.categoryId ?? null,
            guessedProductionId: guess.productionId ?? null,
            confidence: guess.confidence,
            decision: alreadyOnHub ? "DUPLICATE" : "PENDING",
            documentId: alreadyOnHub?.id ?? null,
          },
          update: {},
        });

        found += 1;
        if (alreadyOnHub) duplicates += 1;
      } catch (error) {
        failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { fileCount: found },
  });

  await recordAudit({
    actor,
    action: "import.scan",
    targetType: "ImportBatch",
    targetId: batch.id,
    summary:
      `Scanned ${options.folderName ?? "a Drive folder"} — ${found} files, ${duplicates} already on the hub` +
      (failures.length > 0 ? `, ${failures.length} could not be read` : ""),
    metadata: {
      folderId: options.folderId,
      found,
      duplicates,
      skippedFolders,
      entriesReturned,
      shortcuts,
      shortcutsFollowed,
      shortcutsUnreadable,
      foldersVisited,
      notLookedIn: tooDeep.length,
      sharedDriveFiles,
      sharedDrives: [...sharedDrivesSeen],
      failed: failures.length,
      // Capped: the log is for reading afterwards, and a scan where everything
      // failed would otherwise write 400 messages into one row.
      failures: failures.slice(0, MAX_LOGGED_FAILURES),
    },
  });

  return {
    batchId: batch.id,
    found,
    duplicates,
    skippedFolders,
    failures,
    diagnostics: {
      entriesReturned,
      subfolders: skippedFolders,
      shortcuts,
      shortcutsFollowed,
      shortcutsUnreadable,
      foldersVisited,
      notLookedIn: tooDeep,
      sharedDriveFiles,
      sharedDriveNames: [...sharedDrivesSeen],
    },
  };
}

export type FileDecision = {
  itemId: string;
  categoryId: string;
  productionId?: string | null;
  visibility: Visibility;
};

/**
 * The canonical Drive name for an imported file: the hub's naming rule, with
 * the original file's extension kept so operating systems still recognise it.
 */
function canonicalDriveName(
  config: { namingTemplate: string; currentSeason: string | null },
  input: {
    baseTitle: string;
    originalName: string;
    category: { name: string };
    production: { name: string; abbreviation: string | null; season: string | null } | null;
  },
): string {
  return withExtension(
    documentName(config, {
      baseTitle: input.baseTitle,
      category: input.category,
      production: input.production,
    }),
    input.originalName,
  );
}

/**
 * File a batch of triaged items. Registers each one — the file keeps its
 * current owner and location in Drive; the hub records where it belongs and
 * shares it according to the visibility chosen.
 */
export async function fileImportItems(
  actor: User,
  decisions: FileDecision[],
  options?: { renameInDrive?: boolean },
): Promise<{
  filed: number;
  renamed: number;
  failures: Array<{ name: string; reason: string }>;
  renameFailures: Array<{ name: string; reason: string }>;
}> {
  const failures: Array<{ name: string; reason: string }> = [];
  const renameFailures: Array<{ name: string; reason: string }> = [];
  let filed = 0;
  let renamed = 0;
  const provider = driveProvider();
  const config = await getConfig();

  for (const decision of decisions) {
    const item = await prisma.importItem.findUnique({ where: { id: decision.itemId } });
    if (!item || item.decision !== "PENDING") continue;

    try {
      const category = await prisma.category.findUnique({ where: { id: decision.categoryId } });
      if (!category) throw new Error("that category no longer exists");
      if (category.scope === "PRODUCTION" && !decision.productionId) {
        throw new Error(`${category.name} needs a production`);
      }
      if (category.scope === "STANDING" && decision.productionId) {
        throw new Error(`${category.name} is organisation-wide`);
      }
      if (decision.visibility === "COMPANY" && !category.companyVisible) {
        throw new Error(`${category.name} is not shared with companies`);
      }

      const existing = await prisma.document.findUnique({
        where: { googleFileId: item.googleFileId },
        select: { id: true },
      });
      if (existing) {
        await prisma.importItem.update({
          where: { id: item.id },
          data: { decision: "DUPLICATE", documentId: existing.id },
        });
        continue;
      }

      const production = decision.productionId
        ? await prisma.production.findUnique({ where: { id: decision.productionId } })
        : null;
      // What the file is called, tidied; the hub's naming rule turns that into
      // the name it is listed under, the same one canonicalDriveName produces
      // for the file itself.
      const baseTitle = cleanTitle(item.name);
      const title = documentName(config, { baseTitle, category, production });

      const document = await prisma.document.create({
        data: {
          title,
          baseTitle,
          docType: docTypeFromMime(item.mimeType),
          source: "REGISTERED",
          visibility: decision.visibility,
          categoryId: category.id,
          productionId: decision.productionId ?? null,
          creatorId: actor.id,
          googleFileId: item.googleFileId,
          webViewLink: item.webViewLink,
          driveOwnerEmail: item.ownerEmail,
          driveId: item.driveId,
          driveName: item.driveName,
          sizeBytes: item.sizeBytes,
          mimeType: item.mimeType,
          originalFileName: item.name,
          googleModifiedAt: item.modifiedAt,
          lastEditedAt: item.modifiedAt ?? new Date(),
          lastSyncedAt: new Date(),
          metadata: JSON.stringify({
            createdVia: "import",
            importBatchId: item.batchId,
            driveFolderPath: item.folderPath,
          }),
        },
      });

      // Additive sharing: these files belong to whoever owns them, so the hub
      // adds access without touching anybody else's.
      await syncSharing(document);

      // Label the file with where the hub filed it, so it can be recovered
      // from Drive alone (scripts/rebuild-from-drive.ts). Needs edit access,
      // which the hub does not have on every imported file — hence best
      // effort, the same as the rename below.
      try {
        await provider.setAppProperties(item.googleFileId, {
          hubDocumentId: document.id,
          hubCategory: category.slug,
          hubProduction: production?.slug ?? "",
          hubVisibility: decision.visibility,
        });
      } catch {
        // Not worth reporting: the import itself succeeded, and the file will
        // be recovered from its folder rather than its label.
      }

      // Optionally bring the Drive name into line with the hub's rule. This
      // needs edit access on a file the hub usually does not own, so a refusal
      // is reported rather than treated as a failure to file.
      if (options?.renameInDrive) {
        const driveName = canonicalDriveName(config, {
          baseTitle,
          originalName: item.name,
          category,
          production,
        });
        if (driveName !== item.name) {
          try {
            await provider.renameFile(item.googleFileId, driveName);
            await prisma.document.update({
              where: { id: document.id },
              data: { originalFileName: item.name, lastSyncedAt: new Date() },
            });
            renamed += 1;
          } catch (error) {
            renameFailures.push({
              name: item.name,
              reason:
                (error as Error).message.includes("insufficient") ||
                (error as Error).message.includes("permission")
                  ? "the hub's account cannot edit it"
                  : (error as Error).message,
            });
          }
        }
      }

      await prisma.importItem.update({
        where: { id: item.id },
        data: { decision: "FILED", documentId: document.id },
      });
      filed += 1;
    } catch (error) {
      failures.push({ name: item.name, reason: (error as Error).message });
    }
  }

  if (filed > 0) {
    await recordAudit({
      actor,
      action: "import.file",
      summary: `Filed ${filed} imported ${filed === 1 ? "file" : "files"} onto the hub`,
    });
  }

  return { filed, renamed, failures, renameFailures };
}

/** Strip the noise people put in filenames so hub titles read cleanly. */
export function cleanTitle(fileName: string): string {
  return (
    fileName
      .replace(/\.[A-Za-z0-9]{1,12}$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\b(final|FINAL|v\d+|copy of|Copy of|draft\s*\d*)\b/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—·]+|[\s\-–—·]+$/g, "")
      .trim()
      .slice(0, 160) || fileName.slice(0, 160)
  );
}

/**
 * Files the hub now tracks that somebody else still owns, grouped by owner.
 * This is the list to chase at the end of an import: ownership transfer is the
 * one thing the hub cannot do for you, because Google requires the current
 * owner to initiate it.
 *
 * Files in a shared drive are left out. The drive owns them, so the club
 * already does; there is nobody to chase, and Google has no transfer to
 * perform. They are counted separately by sharedDriveHoldings().
 */
export async function ownershipHandoverList(hubAccountEmail: string | null) {
  const documents = await prisma.document.findMany({
    where: {
      status: "ACTIVE",
      googleFileId: { not: null },
      driveOwnerEmail: { not: null },
      driveId: null,
      ...(hubAccountEmail ? { NOT: { driveOwnerEmail: hubAccountEmail } } : {}),
    },
    select: { id: true, title: true, driveOwnerEmail: true, webViewLink: true },
    orderBy: { title: "asc" },
  });

  const byOwner = new Map<string, typeof documents>();
  for (const document of documents) {
    const owner = document.driveOwnerEmail!;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), document]);
  }
  return [...byOwner.entries()]
    .map(([owner, files]) => ({ owner, files }))
    .sort((a, b) => b.files.length - a.files.length);
}

/**
 * Documents the hub tracks that live in a shared drive, by drive.
 *
 * The counterpart to the chase-list: these are the files nobody has to hand
 * over, and saying so is the point — an empty chase-list on its own is
 * ambiguous between "everything is settled" and "the hub could not tell who
 * owns any of it", which is exactly what a shared drive's missing owner field
 * looks like.
 */
export async function sharedDriveHoldings(): Promise<Array<{ name: string; count: number }>> {
  const rows = await prisma.document.groupBy({
    by: ["driveId", "driveName"],
    where: { status: "ACTIVE", driveId: { not: null } },
    _count: { _all: true },
  });
  return rows
    .map((row) => ({ name: row.driveName ?? "a shared drive", count: row._count._all }))
    .sort((a, b) => b.count - a.count);
}
