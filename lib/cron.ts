import { prisma } from "./db";
import { getConfig } from "./config";
import { recordAudit } from "./audit";
import { canvaEnabled, canvaProvider } from "./canva";
import {
  canvaMirrorIsStale,
  exportCanvaMirror,
  normaliseDocumentTitles,
  runSharingSweep,
} from "./documents";
import { driveProvider } from "./google";
import { sendDigests } from "./email/digest";

/**
 * The scheduled work.
 *
 * Everything here is idempotent, bounded, and safe to call more often than
 * needed — the schedule is a hint, not a contract. Each job decides for itself
 * whether there is anything to do, so a missed run costs nothing and a double
 * run does nothing twice.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Don't re-export a design somebody is still working in. */
export const CANVA_QUIET_MINUTES = 30;
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
  drive: { seen: number; updated: number } | null;
  titles: { scanned: number; changed: number } | null;
  canva: { checked: number; refreshed: number; failures: number } | null;
  digest: { sent: number; skipped: number; failed: number } | null
  skipped: string[];
};

/**
 * How far back a first run looks. Long enough to catch up a hub that has been
 * running without this job, short enough that the first call is still one or
 * two pages of results.
 */
const FIRST_DRIVE_SCAN_DAYS = 90;
/** Re-ask for a minute either side of the last scan, in case of clock skew. */
const DRIVE_SCAN_OVERLAP_MS = 60_000;
/** Most a single run will read; the rest waits for the next one. */
const DRIVE_SCAN_PAGE = 2000;

/**
 * Fold Google's edit times into the hub.
 *
 * Every list is ordered and labelled by when a document was last edited, and
 * for anything in Drive that is a fact only Google holds — somebody opens the
 * rehearsal schedule and types, and nothing tells the hub. Asking per document
 * would be one API call per row of every list, so instead this asks Drive once
 * for everything that changed since the last run and matches the answer up by
 * file id. One or two calls, whatever the size of the hub.
 */
export async function refreshDriveEditTimes(options?: {
  since?: Date;
  limit?: number;
}): Promise<{ seen: number; updated: number }> {
  const config = await getConfig();
  const since =
    options?.since ??
    new Date(
      (config.lastDriveScanAt?.getTime() ?? Date.now() - FIRST_DRIVE_SCAN_DAYS * DAY_MS) -
        DRIVE_SCAN_OVERLAP_MS,
    );

  const startedAt = new Date();
  const changed = await driveProvider().listModifiedSince(
    since,
    options?.limit ?? DRIVE_SCAN_PAGE,
  );
  if (changed.length === 0) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { lastDriveScanAt: startedAt },
    });
    return { seen: 0, updated: 0 };
  }

  const times = new Map(
    changed
      .filter((file) => file.modifiedTime)
      .map((file) => [file.id, new Date(file.modifiedTime!)]),
  );

  // Most of what Drive reports will be files the hub has never heard of, so
  // the matching happens here rather than in a query per file.
  let updated = 0;
  const ids = [...times.keys()];
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200);
    const documents = await prisma.document.findMany({
      where: { googleFileId: { in: batch } },
      select: { id: true, googleFileId: true, lastEditedAt: true },
    });
    for (const document of documents) {
      const modifiedAt = times.get(document.googleFileId!);
      if (!modifiedAt || modifiedAt.getTime() === document.lastEditedAt.getTime()) continue;
      await prisma.document.update({
        where: { id: document.id },
        data: { googleModifiedAt: modifiedAt, lastEditedAt: modifiedAt, lastSyncedAt: startedAt },
      });
      updated += 1;
    }
  }

  // Drive answers newest first, so a truncated answer is missing its oldest
  // end. Marking the scan complete would lose those for good; instead the
  // watermark goes back to the oldest one actually read and the next run
  // starts from there.
  const truncated = changed.length >= (options?.limit ?? DRIVE_SCAN_PAGE);
  const oldestSeen = changed.at(-1)?.modifiedTime;
  await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: {
      lastDriveScanAt: truncated && oldestSeen ? new Date(oldestSeen) : startedAt,
    },
  });
  return { seen: changed.length, updated };
}

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
      // Actorless: the schedule did it, not a person. The run as a whole is
      // summarised separately, but the document's own History should explain
      // why the file in Drive changed.
      await recordAudit({
        action: "canva.export",
        targetType: "Document",
        targetId: mirror.id,
        summary: `The hub took a fresh copy of “${mirror.title}” because the Canva design had changed`,
      });
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
  force?: { sharing?: boolean; drive?: boolean; canva?: boolean; digest?: boolean };
  /** Override the wall-clock budget, e.g. from a longer-lived host. */
  budgetMs?: number;
}): Promise<CronReport> {
  const config = await getConfig();
  const report: CronReport = {
    sharing: null,
    drive: null,
    titles: null,
    canva: null,
    digest: null,
    skipped: [],
  };

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

  // 2. What Google says has changed. Cheap — a call or two — and it is what
  //    every "last edited" on the hub is showing.
  if (Date.now() < startedAt + budget || options?.force?.drive) {
    try {
      report.drive = await refreshDriveEditTimes();
    } catch (error) {
      // Usually "no Google account connected", which is a state the hub runs
      // in quite happily — the other jobs should still get their turn.
      console.error("[cron] could not read Drive's edit times", error);
      report.skipped.push(`drive (${(error as Error).message})`);
    }
  } else {
    report.skipped.push("drive (no time left this run)");
  }

  // 3. The one-off pass that brings titles that predate the naming rule into
  //    line with it. Idempotent, but only worth running unprompted once —
  //    after that it is the admin's button in Settings.
  if (config.titlesNormalisedAt === null) {
    try {
      const result = await normaliseDocumentTitles();
      report.titles = { scanned: result.scanned, changed: result.changed };
    } catch (error) {
      console.error("[cron] could not apply the naming rule", error);
      report.skipped.push(`titles (${(error as Error).message})`);
    }
  } else {
    report.skipped.push("titles (already applied)");
  }

  // 4. Canva mirrors, with whatever is left of the budget.
  if (config.canvaAutoRefresh || options?.force?.canva) {
    const result = await refreshStaleCanvaMirrors({
      force: options?.force?.canva,
      deadline: startedAt + budget,
    });
    report.canva = { checked: result.checked, refreshed: result.refreshed, failures: result.failures };
  } else {
    report.skipped.push("canva (auto-refresh off)");
  }

  // 5. The weekly digest.
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
    (report.drive?.updated ?? 0) > 0 ||
    (report.titles?.changed ?? 0) > 0 ||
    (report.canva?.refreshed ?? 0) > 0 ||
    (report.digest?.sent ?? 0) > 0;

  if (didSomething) {
    await recordAudit({
      action: "cron.run",
      summary: [
        report.sharing?.processed ? `re-shared ${report.sharing.processed}` : null,
        report.drive?.updated ? `took ${report.drive.updated} edit times from Drive` : null,
        report.titles?.changed ? `renamed ${report.titles.changed} to the naming rule` : null,
        report.canva?.refreshed ? `re-exported ${report.canva.refreshed} Canva designs` : null,
        report.digest?.sent ? `sent ${report.digest.sent} digests` : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }

  return report;
}
