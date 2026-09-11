import type { Category, Production, User } from "@prisma/client";
import { prisma } from "./db";
import { driveProvider } from "./google";
import { docTypeFromMime, type Visibility } from "./constants";
import { recordAudit } from "./audit";
import { syncSharing } from "./documents";
import { getConfig } from "./config";
import { applyNamingTemplate, driveViewLink, withExtension } from "./utils";

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
  };
};

/** Walk a Drive folder and record everything worth filing. */
export async function scanDriveFolder(
  actor: User,
  options: { folderId: string; folderName?: string | null; includeSubfolders: boolean },
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
  const tooDeep: string[] = [];

  const queue: Array<{ id: string; path: string; depth: number }> = [
    { id: options.folderId, path: options.folderName ?? "", depth: 0 },
  ];

  while (queue.length > 0 && found < MAX_FILES) {
    const folder = queue.shift()!;
    const entries = await provider.listFolder(folder.id);
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
          });
        } else if (options.includeSubfolders) {
          // Deeper than the walk goes. Counted, because an import that
          // quietly stopped four levels down would look complete.
          tooDeep.push(folder.path ? `${folder.path} / ${entry.name}` : entry.name);
        }
        continue;
      }

      const alreadyOnHub = await prisma.document.findUnique({
        where: { googleFileId: entry.id },
        select: { id: true },
      });

      const guess = alreadyOnHub
        ? { confidence: 0 }
        : guessPlacement(entry.name, folder.path, categories, productions);

      await prisma.importItem.upsert({
        where: { batchId_googleFileId: { batchId: batch.id, googleFileId: entry.id } },
        create: {
          batchId: batch.id,
          googleFileId: entry.id,
          name: entry.name,
          mimeType: entry.mimeType,
          ownerEmail: entry.ownerEmail ?? null,
          webViewLink: entry.webViewLink || driveViewLink(entry.id, docTypeFromMime(entry.mimeType)),
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
    summary: `Scanned ${options.folderName ?? "a Drive folder"} — ${found} files, ${duplicates} already on the hub`,
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
    },
  });

  return {
    batchId: batch.id,
    found,
    duplicates,
    skippedFolders,
    diagnostics: {
      entriesReturned,
      subfolders: skippedFolders,
      shortcuts,
      shortcutsFollowed,
      shortcutsUnreadable,
      foldersVisited,
      notLookedIn: tooDeep,
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
async function canonicalDriveName(input: {
  title: string;
  originalName: string;
  category: { name: string };
  production: { name: string; abbreviation: string | null; season: string | null } | null;
}): Promise<string> {
  const config = await getConfig();
  return withExtension(
    applyNamingTemplate(config.namingTemplate, {
      production: input.production?.abbreviation || input.production?.name || null,
      category: input.category.name,
      title: input.title,
      season: input.production?.season ?? config.currentSeason,
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
      const title = cleanTitle(item.name);

      const document = await prisma.document.create({
        data: {
          title,
          docType: docTypeFromMime(item.mimeType),
          source: "REGISTERED",
          visibility: decision.visibility,
          categoryId: category.id,
          productionId: decision.productionId ?? null,
          creatorId: actor.id,
          googleFileId: item.googleFileId,
          webViewLink: item.webViewLink,
          driveOwnerEmail: item.ownerEmail,
          sizeBytes: item.sizeBytes,
          mimeType: item.mimeType,
          originalFileName: item.name,
          googleModifiedAt: item.modifiedAt,
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
        const driveName = await canonicalDriveName({
          title,
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
 */
export async function ownershipHandoverList(hubAccountEmail: string | null) {
  const documents = await prisma.document.findMany({
    where: {
      status: "ACTIVE",
      googleFileId: { not: null },
      driveOwnerEmail: { not: null },
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
