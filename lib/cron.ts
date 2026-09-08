import { prisma } from "./db";
import { getConfig } from "./config";
import { recordAudit } from "./audit";
import { canvaEnabled, canvaProvider } from "./canva";
import { canvaMirrorIsStale, exportCanvaMirror, runSharingSweep } from "./documents";
import { sendDigests } from "./email/digest";

/**
 * The scheduled work.
 *
 * Everything here is idempotent, bounded, and safe to call more often than
 * needed — the schedule is a hint, not a contract. Each job decides for itself
 * whether there is anything to do, so a missed run costs nothing and a double
 * run does nothing twice.
 */

/** Don't re-export a design somebody is still working in. */
const CANVA_QUIET_MINUTES = 30;
const CANVA_PER_RUN = 5;

export type CronReport = {
  sharing: { processed: number; remaining: number } | null;
  canva: { checked: number; refreshed: number; failures: number } | null;
  digest: { sent: number; skipped: number; failed: number } | null
  skipped: string[];
};

/**
 * Bring Canva mirrors back in line with their originals.
 *
 * Canva has no "design updated" webhook — the notification catalogue covers
 * comments, mentions and sharing, nothing about edits — so the only way to
 * notice an edit is to ask. Asking is cheap (get-design is rate limited at 100
 * a minute); exporting is not, so only designs that have actually moved on and
 * then gone quiet get re-exported.
 */
export async function refreshStaleCanvaMirrors(options?: {
  limit?: number;
  quietMinutes?: number;
  force?: boolean;
}): Promise<{ checked: number; refreshed: number; failures: number; stale: string[] }> {
  if (!canvaEnabled()) return { checked: 0, refreshed: 0, failures: 0, stale: [] };

  const limit = options?.limit ?? CANVA_PER_RUN;
  const quietMinutes = options?.quietMinutes ?? CANVA_QUIET_MINUTES;

  const mirrors = await prisma.document.findMany({
    where: { canvaDesignId: { not: null }, status: "ACTIVE" },
    select: {
      id: true,
      title: true,
      canvaDesignId: true,
      canvaExportedAt: true,
      canvaDesignUpdatedAt: true,
      creatorId: true,
    },
    orderBy: { canvaCheckedAt: "asc" },
    take: 40,
  });

  const provider = canvaProvider();
  const stale: string[] = [];
  let checked = 0;
  let refreshed = 0;
  let failures = 0;

  for (const mirror of mirrors) {
    if (!mirror.canvaDesignId) continue;
    checked += 1;

    let designUpdatedAt = mirror.canvaDesignUpdatedAt;
    try {
      const design = await provider.getDesign(mirror.canvaDesignId);
      designUpdatedAt = design?.updatedAt ?? designUpdatedAt;
      await prisma.document.update({
        where: { id: mirror.id },
        data: {
          canvaDesignUpdatedAt: designUpdatedAt,
          canvaTitle: design?.title ?? undefined,
          canvaCheckedAt: new Date(),
        },
      });
    } catch (error) {
      failures += 1;
      console.error("[cron] could not check Canva design", mirror.canvaDesignId, error);
      continue;
    }

    if (!canvaMirrorIsStale({ ...mirror, canvaDesignUpdatedAt: designUpdatedAt })) continue;
    stale.push(mirror.title);

    // Leave it alone while somebody is still editing.
    const quietFor = designUpdatedAt
      ? Date.now() - designUpdatedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (!options?.force && quietFor < quietMinutes * 60 * 1000) continue;
    if (refreshed >= limit) continue;

    try {
      const actor = await prisma.user.findUnique({ where: { id: mirror.creatorId } });
      if (!actor) continue;
      await exportCanvaMirror(actor, mirror.id, { silent: true });
      refreshed += 1;
    } catch (error) {
      failures += 1;
      console.error("[cron] could not re-export Canva mirror", mirror.id, error);
    }
  }

  if (checked > 0) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { lastCanvaRefreshAt: new Date() },
    });
  }

  return { checked, refreshed, failures, stale };
}

/** Whether the digest is due: the configured day, and not already sent this week. */
export function digestIsDue(config: {
  digestDay: number | null;
  lastDigestAt: Date | null;
  emailEnabled: boolean;
}): boolean {
  if (!config.emailEnabled || config.digestDay === null) return false;
  if (new Date().getDay() !== config.digestDay) return false;
  if (!config.lastDigestAt) return true;
  return Date.now() - config.lastDigestAt.getTime() > 6 * 24 * 60 * 60 * 1000;
}

export async function runScheduledJobs(options?: {
  force?: { sharing?: boolean; canva?: boolean; digest?: boolean };
}): Promise<CronReport> {
  const config = await getConfig();
  const report: CronReport = { sharing: null, canva: null, digest: null, skipped: [] };

  // 1. Finish any re-share sweep that is mid-flight. Two slices per run keeps
  //    each invocation short; the next run picks up where this one stopped.
  if (config.sharingSweepStartedAt || options?.force?.sharing) {
    let processed = 0;
    let remaining = 0;
    for (let slice = 0; slice < 2; slice += 1) {
      const result = await runSharingSweep({ chunk: 12 });
      processed += result.processed;
      remaining = result.remaining;
      if (remaining === 0 || result.processed === 0) break;
    }
    report.sharing = { processed, remaining };
  } else {
    report.skipped.push("sharing (nothing stale)");
  }

  // 2. Canva mirrors.
  if (config.canvaAutoRefresh || options?.force?.canva) {
    const result = await refreshStaleCanvaMirrors({ force: options?.force?.canva });
    report.canva = { checked: result.checked, refreshed: result.refreshed, failures: result.failures };
  } else {
    report.skipped.push("canva (auto-refresh off)");
  }

  // 3. The weekly digest.
  if (digestIsDue(config) || options?.force?.digest) {
    report.digest = await sendDigests();
  } else {
    report.skipped.push(
      config.digestDay === null
        ? "digest (no day set)"
        : !config.emailEnabled
          ? "digest (email off)"
          : "digest (not due)",
    );
  }

  await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: { lastCronAt: new Date() },
  });

  const didSomething =
    (report.sharing?.processed ?? 0) > 0 ||
    (report.canva?.refreshed ?? 0) > 0 ||
    (report.digest?.sent ?? 0) > 0;

  if (didSomething) {
    await recordAudit({
      action: "cron.run",
      summary: [
        report.sharing?.processed ? `re-shared ${report.sharing.processed}` : null,
        report.canva?.refreshed ? `re-exported ${report.canva.refreshed} Canva designs` : null,
        report.digest?.sent ? `sent ${report.digest.sent} digests` : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }

  return report;
}
