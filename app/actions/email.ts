"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { sendDigests } from "@/lib/email/digest";
import { rateLimit, tooManyMessage } from "@/lib/rate-limit";
import { toActionState, type ActionState } from "./shared";

function refresh() {
  revalidatePath("/admin/email");
  revalidatePath("/", "layout");
}

export async function setEmailEnabledAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const enabled = form.get("enabled") === "true";
  await prisma.orgConfig.update({ where: { id: "singleton" }, data: { emailEnabled: enabled } });
  await recordAudit({
    actor,
    action: "config.update",
    summary: enabled ? "Turned the hub's email on" : "Turned the hub's email off",
  });
  refresh();
}

/** Send this week's digest to everybody who has not opted out. */
export async function sendDigestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const justMe = form.get("justMe") !== null;

    // The hub sends through one Gmail account with a real daily quota, and this
    // button mails the whole company at once. Worth a leash even for admins.
    if (!justMe) {
      const limit = await rateLimit("emailSend", actor.id);
      if (!limit.ok) return { error: tooManyMessage(limit, "digest sends") };
    }

    const result = await sendDigests(justMe ? { onlyTo: actor.email } : undefined);
    await recordAudit({
      actor,
      action: "email.digest",
      summary: justMe
        ? "Sent a test digest to themselves"
        : `Sent the weekly digest — ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`,
    });
    refresh();

    const config = await prisma.orgConfig.findUniqueOrThrow({ where: { id: "singleton" } });
    return {
      ok: config.emailEnabled
        ? `${result.sent} digest${result.sent === 1 ? "" : "s"} sent${
            result.skipped > 0 ? `, ${result.skipped} skipped (nothing to report or opted out)` : ""
          }.`
        : `${result.sent + result.skipped} digest${
            result.sent + result.skipped === 1 ? "" : "s"
          } prepared. Email is off, so nothing left the building — read them below.`,
      warnings: result.failed > 0 ? [`${result.failed} failed to send. See the list below.`] : [],
    };
  } catch (error) {
    return toActionState(error);
  }
}

/** Anyone can silence their own digest. */
export async function toggleDigestOptOutAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const optOut = form.get("optOut") === "true";
  await prisma.user.update({ where: { id: user.id }, data: { digestOptOut: optOut } });
  revalidatePath("/", "layout");
}

export async function clearEmailLogAction() {
  const actor = await assertRole("ADMIN");
  const { count } = await prisma.emailMessage.deleteMany({});
  await recordAudit({
    actor,
    action: "config.update",
    summary: `Cleared the email log (${count} message${count === 1 ? "" : "s"})`,
  });
  refresh();
}
