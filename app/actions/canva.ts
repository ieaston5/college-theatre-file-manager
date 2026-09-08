"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { assertRole, getCurrentUser } from "@/lib/auth";
import { canEditDocument, getViewerContext } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { checkCanvaFreshness, exportCanvaMirror } from "@/lib/documents";
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
