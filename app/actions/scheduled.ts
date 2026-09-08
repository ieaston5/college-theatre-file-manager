"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { refreshStaleCanvaMirrors, runScheduledJobs } from "@/lib/cron";
import { text, toActionState, type ActionState } from "./shared";

function refresh() {
  revalidatePath("/admin/scheduled");
  revalidatePath("/", "layout");
}

export async function saveScheduleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const rawDay = text(form, "digestDay");
    const digestDay = rawDay === undefined || rawDay === "never" ? null : Number(rawDay);
    if (digestDay !== null && (Number.isNaN(digestDay) || digestDay < 0 || digestDay > 6)) {
      return { error: "That is not a day of the week." };
    }

    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: {
        digestDay,
        canvaAutoRefresh: form.get("canvaAutoRefresh") !== null,
      },
    });
    await recordAudit({ actor, action: "config.update", summary: "Updated the schedule" });
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toActionState(error);
  }
}

/** Run everything now, exactly as the scheduled job would. */
export async function runNowAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const forceCanva = form.get("forceCanva") !== null;

    const report = await runScheduledJobs({ force: { canva: forceCanva } });
    refresh();

    const parts = [
      report.sharing ? `re-shared ${report.sharing.processed} (${report.sharing.remaining} left)` : null,
      report.canva
        ? `checked ${report.canva.checked} Canva designs, re-exported ${report.canva.refreshed}`
        : null,
      report.digest ? `sent ${report.digest.sent} digests` : null,
    ].filter(Boolean);

    await recordAudit({
      actor,
      action: "cron.run",
      summary: `Ran the scheduled jobs by hand — ${parts.join("; ") || "nothing to do"}`,
    });

    return {
      ok: parts.length > 0 ? `Done: ${parts.join("; ")}.` : "Nothing needed doing.",
      warnings: report.skipped.length > 0 ? [`Skipped: ${report.skipped.join(", ")}.`] : [],
    };
  } catch (error) {
    return toActionState(error);
  }
}

/** Re-export every Canva mirror that has fallen behind, ignoring the quiet period. */
export async function refreshCanvaNowAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const result = await refreshStaleCanvaMirrors({ limit: 25, force: true });
    await recordAudit({
      actor,
      action: "canva.export",
      summary: `Refreshed ${result.refreshed} of ${result.checked} Canva mirrors by hand`,
    });
    refresh();

    if (result.checked === 0) return { ok: "There are no Canva mirrors to check." };
    return {
      ok:
        result.refreshed > 0
          ? `Re-exported ${result.refreshed} ${result.refreshed === 1 ? "design" : "designs"} that had moved on.`
          : `Checked ${result.checked} ${result.checked === 1 ? "design" : "designs"} — all copies are current.`,
      warnings:
        result.failures > 0
          ? [`${result.failures} could not be checked or exported. See the server log.`]
          : [],
    };
  } catch (error) {
    return toActionState(error);
  }
}
