"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { driveProvider, ensureRootFolders } from "@/lib/google";
import { fileImportItems, scanDriveFolder, type FileDecision } from "@/lib/import";
import { extractDriveFileId } from "@/lib/utils";
import { VISIBILITIES, type Visibility } from "@/lib/constants";
import { text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

export async function startScanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const link = text(form, "folder") ?? "";
    const includeSubfolders = form.get("includeSubfolders") !== null;

    let folderId = extractDriveFileId(link);
    if (!folderId) {
      return {
        error: "That does not look like a Drive folder link.",
        hint: "Open the folder in Drive and copy the URL — it looks like drive.google.com/drive/folders/…",
      };
    }

    const provider = driveProvider();
    const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
    const hubEmail = account?.email ?? "the hub's Google account";

    let folder = await provider.getFile(folderId);
    if (!folder) {
      return {
        error: `The hub's Google account (${hubEmail}) cannot see that folder.`,
        hint: "Share the folder with that address — view access is enough to scan it.",
      };
    }

    // "Add shortcut to Drive" makes a separate file that points at the folder.
    // Its own child list is empty, so scanning it finds nothing and looks like
    // a permissions problem. Follow it to the real folder instead.
    if (folder.shortcutTargetId) {
      const target = await provider.getFile(folder.shortcutTargetId);
      if (!target) {
        return {
          error: `That link is a shortcut, and ${hubEmail} cannot see what it points at.`,
          hint: "Share the original folder with that address, or copy the original folder's own link.",
        };
      }
      folderId = folder.shortcutTargetId;
      folder = target;
    }

    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      return {
        error: `That link is a file, not a folder — “${folder.name}”.`,
        hint: "Use Documents → Add existing to file a single document. Import is for whole folders.",
      };
    }

    if (folder.canListChildren === false) {
      return {
        error: `${hubEmail} can see “${folder.name}” but is not allowed to list what is inside it.`,
        hint: "Share the folder itself with that address as a Viewer. Sharing the files individually is not enough — Drive will not enumerate a folder you cannot open.",
      };
    }

    const result = await scanDriveFolder(actor, {
      folderId,
      folderName: folder.name,
      includeSubfolders,
    });

    refreshEverywhere();
    if (result.found === 0) {
      const { entriesReturned, subfolders, shortcuts, shortcutsUnreadable } = result.diagnostics;

      // A folder of shortcuts whose targets are not shared with the hub. The
      // shortcut being shared says nothing about the file it points at.
      if (shortcutsUnreadable > 0 && shortcutsUnreadable === shortcuts) {
        return {
          error: `Everything in “${folder.name}” is a shortcut to a file ${hubEmail} cannot open.`,
          hint: "Sharing a shortcut does not share what it points at. Share the original files (or the folders they live in) with that address, then scan again.",
        };
      }

      // Each of these looks identical from outside and needs a different fix.
      if (entriesReturned === 0) {
        return {
          ok: `Nothing to import: Drive reported “${folder.name}” as empty for ${hubEmail}.`,
          warnings: [
            "If you can see files in it yourself, they are shared with you but the *folder* is not shared with the hub account — Drive only lists children of a folder the asking account can open. Share the folder itself with that address as a Viewer, then scan again.",
          ],
        };
      }
      if (subfolders > 0 && !includeSubfolders) {
        return {
          ok: `Nothing to import at the top level of ${folder.name}, but it holds ${subfolders} ${
            subfolders === 1 ? "subfolder" : "subfolders"
          }.`,
          warnings: ["Tick “include subfolders” and scan again."],
        };
      }
      return {
        ok: `Nothing to import from ${folder.name}.`,
        warnings: [
          `Drive returned ${entriesReturned} ${entriesReturned === 1 ? "entry" : "entries"}: ${subfolders} ${
            subfolders === 1 ? "subfolder" : "subfolders"
          }, ${shortcuts} ${shortcuts === 1 ? "shortcut" : "shortcuts"}, and no files.` +
            (shortcutsUnreadable > 0
              ? ` ${shortcutsUnreadable} of those shortcuts point at files ${hubEmail} cannot open — share the originals, not the shortcuts.`
              : ""),
        ],
      };
    }
    const followed = result.diagnostics.shortcutsFollowed;
    const unreadable = result.diagnostics.shortcutsUnreadable;
    return {
      ok: `Found ${result.found} ${result.found === 1 ? "file" : "files"} in ${folder.name}${
        result.duplicates > 0 ? `, ${result.duplicates} already on the hub` : ""
      }${followed > 0 ? `, following ${followed} ${followed === 1 ? "shortcut" : "shortcuts"} to the real file` : ""}.`,
      warnings:
        unreadable > 0
          ? [
              `${unreadable} ${unreadable === 1 ? "shortcut points" : "shortcuts point"} at ${
                unreadable === 1 ? "a file" : "files"
              } ${hubEmail} cannot open, so ${unreadable === 1 ? "it was" : "they were"} left out. Sharing a shortcut does not share what it points at.`,
            ]
          : [],
      documentId: result.batchId,
    };
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * File whatever the person ticked. The form carries one row per item, so the
 * common path — select twelve budget files, set the category once, file them —
 * is a single request.
 */
export async function fileItemsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const selected = form.getAll("selected").map(String).filter(Boolean);
    if (selected.length === 0) {
      return { error: "Tick the files you want to file first." };
    }

    const decisions: FileDecision[] = [];
    const missing: string[] = [];

    for (const itemId of selected) {
      const categoryId = text(form, `category:${itemId}`);
      const productionId = text(form, `production:${itemId}`);
      const visibility = text(form, `visibility:${itemId}`) ?? "BOARD";
      if (!categoryId) {
        missing.push(itemId);
        continue;
      }
      decisions.push({
        itemId,
        categoryId,
        productionId: productionId && productionId !== "none" ? productionId : null,
        visibility: (VISIBILITIES as readonly string[]).includes(visibility)
          ? (visibility as Visibility)
          : "BOARD",
      });
    }

    const renameInDrive = form.get("renameInDrive") !== null;
    const { filed, renamed, failures, renameFailures } = await fileImportItems(
      actor,
      decisions,
      { renameInDrive },
    );
    refreshEverywhere();

    const warnings = failures.map((failure) => `${failure.name}: ${failure.reason}`);
    if (renameFailures.length > 0) {
      warnings.push(
        `${renameFailures.length} ${
          renameFailures.length === 1 ? "file was" : "files were"
        } filed but not renamed in Drive: ${renameFailures
          .slice(0, 4)
          .map((failure) => `${failure.name} (${failure.reason})`)
          .join("; ")}${renameFailures.length > 4 ? "…" : ""}. They keep their current names.`,
      );
    }
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} ${missing.length === 1 ? "file was" : "files were"} skipped because no category was picked for them.`,
      );
    }

    if (filed === 0) {
      return { error: "Nothing was filed.", warnings };
    }
    return {
      ok: `Filed ${filed} ${filed === 1 ? "file" : "files"}${
        renameInDrive && renamed > 0
          ? `, and renamed ${renamed} in Drive to match the hub's rule`
          : ""
      }. They are on the dashboard now.`,
      warnings,
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function skipItemsAction(form: FormData) {
  await assertRole("ADMIN");
  const selected = form.getAll("selected").map(String).filter(Boolean);
  if (selected.length === 0) return;
  await prisma.importItem.updateMany({
    where: { id: { in: selected }, decision: "PENDING" },
    data: { decision: "SKIPPED" },
  });
  refreshEverywhere();
}

export async function unskipItemAction(form: FormData) {
  await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  await prisma.importItem.updateMany({
    where: { id, decision: "SKIPPED" },
    data: { decision: "PENDING" },
  });
  revalidatePath("/admin/import");
}

export async function deleteBatchAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) return;
  await prisma.importBatch.delete({ where: { id } });
  await recordAudit({
    actor,
    action: "import.discard",
    summary: `Discarded the scan of ${batch.sourceFolderName ?? "a Drive folder"}`,
  });
  refreshEverywhere();
  redirect("/admin/import");
}

/**
 * Simulated Drive only: build a folder of realistically messy files so the
 * import can be tried before pointing it at the club's real Drive.
 */
export async function createSampleMessAction(): Promise<void> {
  const actor = await assertRole("ADMIN");
  if (env.driveMode !== "mock") return;

  const provider = driveProvider();
  const { rootFolderId } = await ensureRootFolders();
  const root = await provider.ensureFolder("Old Penn Players Drive (sample mess)", rootFolderId);

  const layout: Array<{ folder: string | null; files: Array<[string, string, string]> }> = [
    {
      folder: null,
      files: [
        ["Constitution FINAL v3.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "rowan.ellis@pennplayers.example"],
        ["penn players contact list 2025.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "maya.o@pennplayers.example"],
        ["random photo IMG_4821.jpg", "image/jpeg", "sam.w@pennplayers.example"],
      ],
    },
    {
      folder: "Urinetown",
      files: [
        ["URINETOWN budget master", "application/vnd.google-apps.spreadsheet", "priya.n@pennplayers.example"],
        ["Urinetown rehearsal schedule OCT", "application/vnd.google-apps.spreadsheet", "maya.o@pennplayers.example"],
        ["urinetown light plot v2", "application/vnd.google-apps.spreadsheet", "diego.salas@pennplayers.example"],
        ["Urinetown props list", "application/vnd.google-apps.spreadsheet", "maya.o@pennplayers.example"],
        ["Urinetown poster copy FINAL", "application/vnd.google-apps.document", "sam.w@pennplayers.example"],
        ["urinetown script cuts.pdf", "application/pdf", "rowan.ellis@pennplayers.example"],
      ],
    },
    {
      folder: "Much Ado 2026",
      files: [
        ["much ado closing budget", "application/vnd.google-apps.spreadsheet", "priya.n@pennplayers.example"],
        ["MuchAdo box office numbers", "application/vnd.google-apps.spreadsheet", "sam.w@pennplayers.example"],
        ["much ado costume measurements", "application/vnd.google-apps.spreadsheet", "bea.l@pennplayers.example"],
      ],
    },
    {
      folder: "Board stuff",
      files: [
        ["minutes 2026-08-26", "application/vnd.google-apps.document", "rowan.ellis@pennplayers.example"],
        ["minutes 2026-09-09", "application/vnd.google-apps.document", "rowan.ellis@pennplayers.example"],
        ["SAC grant application spring", "application/vnd.google-apps.document", "priya.n@pennplayers.example"],
        ["treasurer handover notes", "application/vnd.google-apps.document", "priya.n@pennplayers.example"],
        ["iron gate space request form", "application/vnd.google-apps.document", "diego.salas@pennplayers.example"],
      ],
    },
  ];

  const { writeMockUpload } = await import("@/lib/google/mock");
  let created = 0;
  for (const group of layout) {
    const parent = group.folder ? await provider.ensureFolder(group.folder, root) : root;
    for (const [name, mimeType, owner] of group.files) {
      const existing = (await provider.listFolder(parent)).find((file) => file.name === name);
      if (existing) continue;
      writeMockUpload({
        name,
        mimeType,
        parentFolderId: parent,
        bytes: Buffer.from(`simulated pre-existing file: ${name}`),
        ownerEmail: owner,
      });
      created += 1;
    }
  }

  await recordAudit({
    actor,
    action: "import.sample",
    summary: `Created ${created} sample pre-existing files to try the import on`,
  });
  refreshEverywhere();
  redirect("/admin/import?sample=1");
}
