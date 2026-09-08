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

    const folderId = extractDriveFileId(link);
    if (!folderId) {
      return {
        error: "That does not look like a Drive folder link.",
        hint: "Open the folder in Drive and copy the URL — it looks like drive.google.com/drive/folders/…",
      };
    }

    const provider = driveProvider();
    const folder = await provider.getFile(folderId);
    if (!folder) {
      const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
      return {
        error: `The hub's Google account (${account?.email ?? "not connected"}) cannot see that folder.`,
        hint: "Share the folder with that address — view access is enough to scan it.",
      };
    }

    const result = await scanDriveFolder(actor, {
      folderId,
      folderName: folder.name,
      includeSubfolders,
    });

    refreshEverywhere();
    if (result.found === 0) {
      return {
        ok: `Nothing to import from ${folder.name} — no files found${
          includeSubfolders ? "" : " (subfolders were not searched)"
        }.`,
      };
    }
    return {
      ok: `Found ${result.found} ${result.found === 1 ? "file" : "files"} in ${folder.name}${
        result.duplicates > 0 ? `, ${result.duplicates} already on the hub` : ""
      }.`,
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

    const { filed, failures } = await fileImportItems(actor, decisions);
    refreshEverywhere();

    const warnings = failures.map((failure) => `${failure.name}: ${failure.reason}`);
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} ${missing.length === 1 ? "file was" : "files were"} skipped because no category was picked for them.`,
      );
    }

    if (filed === 0) {
      return { error: "Nothing was filed.", warnings };
    }
    return {
      ok: `Filed ${filed} ${filed === 1 ? "file" : "files"}. They are on the dashboard now.`,
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
