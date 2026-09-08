"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { assertRole, getCurrentUser } from "@/lib/auth";
import { canEditDocument, canViewDocument, getViewerContext } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { canvaEnabled } from "@/lib/canva";
import { CANVA_QUIET_MINUTES } from "@/lib/cron";
import { canvaMirrorIsStale, checkCanvaFreshness, exportCanvaMirror } from "@/lib/documents";
import { toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

async function editableCanvaDocument(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Reload the page and sign in again.");
  const document = await prisma.document.findUnique({
    where: { id },
    include: { shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canEditDocument(viewer, document)) {
    throw new Error("That document is not yours to change.");
  }
  if (!document.canvaDesignId) throw new Error("That document is not a Canva mirror.");
  return { user, document };
}

/** Pull the current state of the design from Canva into Drive again. */
export async function reexportCanvaAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  try {
    const { user } = await editableCanvaDocument(id);
    const { warnings } = await exportCanvaMirror(user, id);
    refreshEverywhere();
    return {
      ok: "Re-exported. The link, the sharing and the file are unchanged — only the contents moved on.",
      warnings,
      documentId: id,
    };
  } catch (error) {
    return toActionState(error);
  }
}

/** Ask Canva whether the original has changed since the last export. */
export async function checkCanvaFreshnessAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  await editableCanvaDocument(id);
  await checkCanvaFreshness(id);
  revalidatePath(`/documents/${id}`);
}

/** How long a check is trusted before somebody opening the page asks again. */
const CHECK_TRUSTED_MINUTES = 5;

/**
 * Bring the copy up to date because somebody is looking at it.
 *
 * The scheduled job is the wrong instrument for this on a host whose free plan
 * only runs cron once a day: the copy in Drive could be a day behind, and
 * worse, the page would say it was current because the *check* was also a day
 * old. So the page asks when it is opened. Asking Canva is cheap — get-design
 * is rate limited at 100 a minute — and it happens at the one moment the
 * answer matters, just before somebody clicks through to the Drive file.
 *
 * Any viewer may trigger this, not just an editor: a cast member opening a
 * poster is exactly who should not be handed last week's version. The export
 * is attributed to whoever filed the document rather than to the viewer, since
 * it is the hub's housekeeping and not their action.
 *
 * Deliberately conservative:
 *  - a check less than five minutes old is trusted, so a page that is
 *    refreshed repeatedly does not hammer Canva;
 *  - a design edited in the last half hour is reported but not exported, the
 *    same quiet period the scheduled job uses, so nobody's copy is taken
 *    mid-edit;
 *  - honouring the "keep Canva copies up to date on their own" setting, so an
 *    admin who turns it off gets checks and no exports;
 *  - and it never throws: a Canva outage must not take a document page down.
 */
export async function refreshCanvaOnOpenAction(documentId: string): Promise<{
  checked: boolean;
  stale: boolean;
  exported: boolean;
}> {
  const quiet = { checked: false, stale: false, exported: false };
  try {
    if (!canvaEnabled()) return quiet;

    const user = await getCurrentUser();
    if (!user) return quiet;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { shares: { select: { userId: true } } },
    });
    if (!document?.canvaDesignId || document.status !== "ACTIVE") return quiet;

    const viewer = await getViewerContext(user);
    if (!canViewDocument(viewer, document)) return quiet;

    const checkedAgoMs = document.canvaCheckedAt
      ? Date.now() - document.canvaCheckedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (checkedAgoMs < CHECK_TRUSTED_MINUTES * 60 * 1000) return quiet;

    const updated = await checkCanvaFreshness(documentId);
    if (!updated) return quiet;

    const stale = canvaMirrorIsStale(updated);
    const settledFor = updated.canvaDesignUpdatedAt
      ? Date.now() - updated.canvaDesignUpdatedAt.getTime()
      : Number.POSITIVE_INFINITY;

    const config = await getConfig();
    if (!stale || !config.canvaAutoRefresh || settledFor < CANVA_QUIET_MINUTES * 60 * 1000) {
      return { checked: true, stale, exported: false };
    }

    // Whoever filed it owns the housekeeping. If they have since been removed,
    // fall back to the viewer so the copy still gets refreshed.
    const owner = (await prisma.user.findUnique({ where: { id: updated.creatorId } })) ?? user;
    await exportCanvaMirror(owner, documentId, { silent: true });

    // Recorded with no actor, because nobody did this: the file in Drive
    // changed on its own and the document's History should say so. Not noisy —
    // it only happens when the design has actually moved on.
    await recordAudit({
      action: "canva.export",
      targetType: "Document",
      targetId: documentId,
      summary: `The hub took a fresh copy of “${updated.title}” because the Canva design had changed`,
    });

    revalidatePath(`/documents/${documentId}`);
    return { checked: true, stale: true, exported: true };
  } catch (error) {
    console.error("[canva] could not refresh on open", error);
    return quiet;
  }
}

/**
 * Simulated-Canva only: pretend somebody edited the design, so the
 * "this copy is behind the original" path can be demonstrated.
 */
export async function simulateCanvaEditAction(form: FormData) {
  if (env.canvaMode !== "mock") return;
  const id = String(form.get("id") ?? "");
  const { document } = await editableCanvaDocument(id);
  const { touchMockDesign } = await import("@/lib/canva/mock");
  touchMockDesign(document.canvaDesignId!);
  await checkCanvaFreshness(id);
  revalidatePath(`/documents/${id}`);
}

export async function disconnectCanvaAction() {
  const actor = await assertRole("ADMIN");
  await prisma.canvaAccount.deleteMany({ where: { id: "singleton" } });
  await recordAudit({
    actor,
    action: "canva.disconnect",
    summary: "Disconnected the hub's Canva account",
  });
  refreshEverywhere();
  redirect("/admin?canva_disconnected=1");
}
