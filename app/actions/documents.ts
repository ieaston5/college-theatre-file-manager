"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canDeleteDocument,
  canEditDocument,
  canManageShares,
  canViewDocument,
  getViewerContext,
} from "@/lib/access";
import {
  createDocument,
  mirrorCanvaDesign,
  registerDocument,
  removeDocument,
  setDocumentStatus,
  shareDocument,
  syncDocument,
  unshareDocument,
  updateDocument,
} from "@/lib/documents";
import {
  canvaMirrorSchema,
  createDocumentSchema,
  firstError,
  registerDocumentSchema,
  shareSchema,
  updateDocumentSchema,
} from "@/lib/validation";
import { bool, text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

/** Loads a document the current user is allowed to change. */
async function editableDocument(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Reload the page and sign in again.");
  const document = await prisma.document.findUnique({
    where: { id },
    include: { shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canViewDocument(viewer, document)) {
    throw new Error("That document is not available to you.");
  }
  if (!canEditDocument(viewer, document)) {
    throw new Error("Only the person who filed this document (or an admin) can change it.");
  }
  return { user, document };
}

// --- create -----------------------------------------------------------------

export async function createDocumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await assertRole("BOARD");

    // Canva shares the same form: a design is mirrored rather than created,
    // because Canva has no way to let the hub manage who can open it.
    if (text(form, "docType") === "CANVA") {
      const parsedCanva = canvaMirrorSchema.safeParse({
        link: text(form, "canvaLink") ?? "",
        title: text(form, "title"),
        description: text(form, "description"),
        categoryId: text(form, "categoryId") ?? "",
        productionId: text(form, "productionId"),
        visibility: text(form, "visibility"),
        tags: text(form, "tags"),
        format: text(form, "canvaFormat") ?? "pdf",
      });
      if (!parsedCanva.success) return { error: firstError(parsedCanva.error) };

      const mirrored = await mirrorCanvaDesign(user, parsedCanva.data);
      refreshEverywhere();
      return {
        ok: `“${mirrored.document.title}” is mirrored and filed.`,
        warnings: mirrored.warnings,
        documentId: mirrored.document.id,
        openUrl: mirrored.document.webViewLink ?? undefined,
      };
    }

    const parsed = createDocumentSchema.safeParse({
      title: text(form, "title") ?? "",
      description: text(form, "description"),
      docType: text(form, "docType"),
      categoryId: text(form, "categoryId") ?? "",
      productionId: text(form, "productionId"),
      visibility: text(form, "visibility"),
      templateId: text(form, "templateId"),
      tags: text(form, "tags"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const { document, warnings } = await createDocument(user, parsed.data);
    refreshEverywhere();
    return {
      ok: `“${document.title}” is filed and ready.`,
      warnings,
      documentId: document.id,
      openUrl: document.webViewLink ?? undefined,
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function registerDocumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await assertRole("BOARD");
    const parsed = registerDocumentSchema.safeParse({
      title: text(form, "title") ?? "",
      description: text(form, "description"),
      link: text(form, "link") ?? "",
      categoryId: text(form, "categoryId") ?? "",
      productionId: text(form, "productionId"),
      visibility: text(form, "visibility"),
      tags: text(form, "tags"),
      organize: bool(form, "organize"),
      externalOnly: bool(form, "externalOnly"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const { document, warnings } = await registerDocument(user, parsed.data);
    refreshEverywhere();
    return {
      ok: `“${document.title}” is now on the hub.`,
      warnings,
      documentId: document.id,
      openUrl: document.webViewLink ?? undefined,
    };
  } catch (error) {
    return toActionState(error);
  }
}

// --- update -----------------------------------------------------------------

export async function updateDocumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = text(form, "id");
  try {
    if (!id) return { error: "Missing document id." };
    const { user } = await editableDocument(id);
    const parsed = updateDocumentSchema.safeParse({
      id,
      title: text(form, "title") ?? "",
      description: text(form, "description"),
      categoryId: text(form, "categoryId") ?? "",
      productionId: text(form, "productionId"),
      visibility: text(form, "visibility"),
      tags: text(form, "tags"),
      pinned: bool(form, "pinned"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const { warnings } = await updateDocument(user, parsed.data);
    refreshEverywhere();
    if (warnings.length > 0) return { ok: "Saved.", warnings, documentId: id };
  } catch (error) {
    return toActionState(error);
  }
  redirect(`/documents/${id}?saved=1`);
}

// --- small one-button actions ----------------------------------------------

export async function togglePinAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { document } = await editableDocument(id);
  await prisma.document.update({ where: { id }, data: { pinned: !document.pinned } });
  refreshEverywhere();
}

export async function setStatusAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "ACTIVE") === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
  const { user } = await editableDocument(id);
  await setDocumentStatus(user, id, status);
  refreshEverywhere();
}

export async function syncDocumentAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const user = await getCurrentUser();
  if (!user) return;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canViewDocument(viewer, document)) return;
  await syncDocument(user, id);
  revalidatePath(`/documents/${id}`);
}

export async function deleteDocumentAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const trashInDrive = form.get("trashInDrive") === "on";
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out.");
  const document = await prisma.document.findUnique({
    where: { id },
    include: { shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canViewDocument(viewer, document) || !canDeleteDocument(viewer, document)) {
    throw new Error("That document is not yours to remove.");
  }
  await removeDocument(user, id, trashInDrive);
  refreshEverywhere();
  redirect("/documents?removed=1");
}

// --- individual shares ------------------------------------------------------

export async function shareDocumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const parsed = shareSchema.safeParse({
      documentId: text(form, "documentId") ?? "",
      userId: text(form, "userId") ?? "",
      accessLevel: text(form, "accessLevel") ?? "READER",
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const user = await getCurrentUser();
    if (!user) return { error: "You are signed out." };
    const document = await prisma.document.findUnique({
      where: { id: parsed.data.documentId },
      include: { shares: { select: { userId: true } } },
    });
    const viewer = await getViewerContext(user);
    if (!document || !canViewDocument(viewer, document) || !canManageShares(viewer, document)) {
      return { error: "You cannot change who sees that document." };
    }

    const warnings = await shareDocument(user, parsed.data);
    revalidatePath(`/documents/${parsed.data.documentId}`);
    return { ok: "Access updated.", warnings };
  } catch (error) {
    return toActionState(error);
  }
}

export async function unshareDocumentAction(form: FormData) {
  const documentId = String(form.get("documentId") ?? "");
  const userId = String(form.get("userId") ?? "");
  const user = await getCurrentUser();
  if (!user) return;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canManageShares(viewer, document)) return;
  await unshareDocument(user, documentId, userId);
  revalidatePath(`/documents/${documentId}`);
}
