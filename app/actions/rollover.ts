"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole, getCurrentUser } from "@/lib/auth";
import { canEditDocument, getViewerContext } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { runRollover } from "@/lib/rollover";
import { seedChecklistFor } from "@/lib/checklist";
import { shareDocument } from "@/lib/documents";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { rateLimit, tooManyMessage } from "@/lib/rate-limit";
import { text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

// --- season rollover --------------------------------------------------------

export async function runRolloverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const showIds = form.getAll("showIds").map(String).filter(Boolean);
    const memberIds = form.getAll("memberIds").map(String).filter(Boolean);
    const newSeason = text(form, "newSeason");
    const moveFolders = form.get("moveFolders") !== null;

    if (showIds.length === 0 && memberIds.length === 0 && !newSeason) {
      return { error: "Nothing was selected, so nothing was changed." };
    }

    const result = await runRollover(actor, { newSeason, showIds, memberIds, moveFolders });
    refreshEverywhere();

    const parts: string[] = [];
    if (result.archivedShows.length > 0) {
      parts.push(
        `archived ${result.archivedShows.length} ${
          result.archivedShows.length === 1 ? "show" : "shows"
        }`,
      );
    }
    if (result.disabledMembers.length > 0) {
      parts.push(`disabled ${result.disabledMembers.length}`);
    }
    if (result.foldersMoved > 0) parts.push(`moved ${result.foldersMoved} Drive folders`);
    if (newSeason) parts.push(`set the season to ${newSeason}`);

    return {
      ok: `Done — ${parts.join(", ")}.`,
      warnings: result.warnings,
    };
  } catch (error) {
    return toActionState(error);
  }
}

// --- access requests --------------------------------------------------------

/**
 * Ask for access to a document you cannot see.
 *
 * Deliberately indistinguishable from asking about an id that does not exist:
 * the same reply comes back either way, so this cannot be used to discover
 * whether a document is there.
 */
export async function requestAccessAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "You are signed out." };

  const documentId = text(form, "documentId") ?? "";
  const message = text(form, "message");
  const sameAnswer = {
    ok: "Request sent. Whoever looks after it will get in touch — the hub does not tell you anything else about it.",
  };

  try {
    const limit = await rateLimit("accessRequest", user.id);
    if (!limit.ok) return { error: tooManyMessage(limit, "access requests") };

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { shares: { select: { userId: true } }, creator: true, category: true },
    });
    if (!document) return sameAnswer;

    const viewer = await getViewerContext(user);
    const { canViewDocument } = await import("@/lib/access");
    if (canViewDocument(viewer, document)) {
      return { ok: "You already have access to that — reload the page." };
    }

    await prisma.accessRequest.upsert({
      where: { documentId_userId: { documentId: document.id, userId: user.id } },
      create: { documentId: document.id, userId: user.id, message: message ?? null, status: "PENDING" },
      update: { message: message ?? null, status: "PENDING", decidedById: null, decidedAt: null },
    });

    await recordAudit({
      actor: user,
      action: "access.request",
      targetType: "Document",
      targetId: document.id,
      summary:
        document.visibility === "PRIVATE"
          ? `${user.email} asked for access to a private document in ${document.category.name}`
          : `${user.email} asked for access to “${document.title}”`,
    });

    // Tell the owner, if the hub is sending mail.
    const config = await getConfig();
    const { sendEmailQuietly } = await import("@/lib/email");
    if (config.emailEnabled) {
      sendEmailQuietly({
        to: document.creator.email,
        relatedId: document.id,
        message: {
          kind: "SHARE",
          subject: `${user.name ?? user.email} is asking for access to "${document.title}"`,
          body: [
            `${user.name ?? user.email} (${user.email}) has asked for access to “${document.title}” on the ${config.orgName} hub.`,
            message ? `\nThey said: ${message}` : "",
            `\nGrant or decline it here: ${env.appUrl.replace(/\/$/, "")}/documents/${document.id}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }

    revalidatePath(`/documents/${document.id}`);
    return sameAnswer;
  } catch (error) {
    console.error("[access] request failed", error);
    return sameAnswer;
  }
}

export async function decideAccessRequestAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = String(form.get("id") ?? "");
  const grant = form.get("grant") === "true";

  const request = await prisma.accessRequest.findUnique({
    where: { id },
    include: {
      user: true,
      document: { include: { shares: { select: { userId: true } } } },
    },
  });
  if (!request) return;

  const viewer = await getViewerContext(user);
  if (!canEditDocument(viewer, request.document)) return;

  if (grant) {
    await shareDocument(user, {
      documentId: request.documentId,
      userId: request.userId,
      accessLevel: "READER",
    });
  }

  await prisma.accessRequest.update({
    where: { id },
    data: {
      status: grant ? "GRANTED" : "DECLINED",
      decidedById: user.id,
      decidedAt: new Date(),
    },
  });

  await recordAudit({
    actor: user,
    action: grant ? "access.grant" : "access.decline",
    targetType: "Document",
    targetId: request.documentId,
    summary: `${grant ? "Granted" : "Declined"} ${request.user.email}'s request${
      request.document.visibility === "PRIVATE" ? "" : ` for “${request.document.title}”`
    }`,
  });

  refreshEverywhere();
}

// --- checklists -------------------------------------------------------------

export async function toggleChecklistItemAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const viewer = await getViewerContext(user);
  const { canCreateDocuments } = await import("@/lib/access");
  if (!canCreateDocuments(viewer)) return;

  const id = String(form.get("id") ?? "");
  const item = await prisma.checklistItem.findUnique({ where: { id } });
  if (!item) return;

  await prisma.checklistItem.update({
    where: { id },
    data: item.done
      ? { done: false, doneAt: null, doneById: null }
      : { done: true, doneAt: new Date(), doneById: user.id },
  });
  revalidatePath("/productions");
  revalidatePath(`/productions`, "layout");
}

export async function seedChecklistAction(form: FormData) {
  await assertRole("BOARD");
  const productionId = String(form.get("productionId") ?? "");
  await seedChecklistFor(productionId);
  refreshEverywhere();
}

export async function addChecklistItemAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await assertRole("BOARD");
    const productionId = text(form, "productionId") ?? "";
    const label = text(form, "label");
    if (!label) return { error: "Give the item a name." };

    const last = await prisma.checklistItem.findFirst({
      where: { productionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.checklistItem.create({
      data: {
        productionId,
        label,
        categoryId: text(form, "categoryId") === "none" ? null : (text(form, "categoryId") ?? null),
        sortOrder: (last?.sortOrder ?? 0) + 10,
      },
    });
    refreshEverywhere();
    return { ok: "Added." };
  } catch (error) {
    return toActionState(error);
  }
}

export async function removeChecklistItemAction(form: FormData) {
  await assertRole("BOARD");
  const id = String(form.get("id") ?? "");
  await prisma.checklistItem.deleteMany({ where: { id } });
  refreshEverywhere();
}
