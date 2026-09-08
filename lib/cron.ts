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
const CANVA_PER_RUN = 25;

/**
 * How long a run may take before it stops and leaves the rest for next time.
 *
 * Bounded by wall clock rather than a fixed number of documents, because how
 * often the host calls is not up to the app: Vercel's free plan will only run
 * a cron job once a day, so a run that did a token twelve documents would take
 * a fortnight to finish a sweep of a real hub. A run therefore does as much as
 * it safely can inside the function's 60-second ceiling (see maxDuration in
 * app/api/cron/route.ts) and stops with work left over rather than being
 * killed mid-document.
 */
const BUDGET_MS = 40_000;
/** Sharing first, but never more than this share of the budget. */
const SHARING_BUDGET_FRACTION = 0.45;
/** A slice of a sweep is 12 documents, each a few Drive permission calls. */
const SWEEP_CHUNK = 12;

export type CronReport = {
  sharing: { processed: number; remaining: number; slices: number } | null;
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
  /** Wall-clock cutoff; the loop stops cleanly rather than being killed. */
  deadline?: number;
}): Promise<{ checked: number; refreshed: number; failures: number; stale: string[] }> {
  if (!canvaEnabled()) return { checked: 0, refreshed: 0, failures: 0, stale: [] };

  const limit = options?.limit ?? CANVA_PER_RUN;
  const quietMinutes = options?.quietMinutes ?? CANVA_QUIET_MINUTES;
  const deadline = options?.deadline ?? Number.POSITIVE_INFINITY;

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
    if (Date.now() > deadline) break;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the digest is due: the configured day, and not already sent.
 *
 * With an hourly schedule the "is it the right day" test had two dozen chances
 * to be true each week. On a daily schedule it has exactly one — so a single
 * missed or failed run would silently cost a whole week. Hence the catch-up
 * clause: once a digest is more than eight days overdue it goes out on the
 * next run whatever the weekday, and the schedule resettles from there.
 *
 * The weekday is read in the server's timezone, which on a host like Vercel is
 * UTC rather than Philadelphia.
 */
export function digestIsDue(config: {
  digestDay: number | null;
  lastDigestAt: Date | null;
  emailEnabled: boolean;
}): boolean {
  if (!config.emailEnabled || config.digestDay === null) return false;

  // Never sent: wait for the chosen day rather than mailing everybody the
  // moment somebody turns email on.
  if (!config.lastDigestAt) return new Date().getDay() === config.digestDay;

  const since = Date.now() - config.lastDigestAt.getTime();
  if (new Date().getDay() === config.digestDay) return since > 6 * DAY_MS;
  return since > 8 * DAY_MS;
}

export async function runScheduledJobs(options?: {
  force?: { sharing?: boolean; canva?: boolean; digest?: boolean };
  /** Override the wall-clock budget, e.g. from a longer-lived host. */
  budgetMs?: number;
}): Promise<CronReport> {
  const config = await getConfig();
  const report: CronReport = { sharing: null, canva: null, digest: null, skipped: [] };

  const startedAt = Date.now();
  const budget = options?.budgetMs ?? BUDGET_MS;

  // 1. Finish any re-share sweep that is mid-flight, a slice at a time until
  //    the sweep is done or this run's share of the budget is spent. Whatever
  //    is left is still marked stale, so the next run continues from there.
  if (config.sharingSweepStartedAt || options?.force?.sharing) {
    const sharingDeadline = startedAt + budget * SHARING_BUDGET_FRACTION;
    let processed = 0;
    let remaining = 0;
    let slices = 0;
    while (Date.now() < sharingDeadline) {
      const result = await runSharingSweep({ chunk: SWEEP_CHUNK });
      processed += result.processed;
      remaining = result.remaining;
      slices += 1;
      if (remaining === 0 || result.processed === 0) break;
    }
    report.sharing = { processed, remaining, slices };
  } else {
    report.skipped.push("sharing (nothing stale)");
  }

  // 2. Canva mirrors, with whatever is left of the budget.
  if (config.canvaAutoRefresh || options?.force?.canva) {
    const result = await refreshStaleCanvaMirrors({
      force: options?.force?.canva,
      deadline: startedAt + budget,
    });
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
