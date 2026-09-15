import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { syncSharing } from "./documents";

/**
 * The re-share queue.
 *
 * Who may open a file in Drive is decided by the hub's data — production
 * membership → role → categories, plus the board's member list — and every one
 * of those grants is an individual Drive permission. That makes access changes
 * cheap to *decide* and expensive to *apply*: moving one person from Cast to
 * Stage management can change access on every company document of a show, at
 * one Google call per person per file.
 *
 * Applying them inline meant the person who pressed Save watched a spinner
 * while several hundred Google calls went out, on a request that could time out
 * halfway and leave no record of what was left to do. So the two halves are
 * separated. The hub writes down *that* a document's permissions are out of
 * date — one statement, no Google — and the queue is drained afterwards:
 *
 *   1. straight after the response, via `after()`, so in practice it is done
 *      within a second or two of the save and nobody waits for it;
 *   2. by whichever page is open, which polls the progress and nudges a slice
 *      along, so a big change visibly finishes while somebody watches;
 *   3. by the scheduled run, which is the backstop for a queue whose browser
 *      went away mid-drain.
 *
 * None of the three needs the others, and running two at once is harmless:
 * a renewable per-document lease serializes provider calls, and a generation
 * check prevents old results from clearing newer changes.
 *
 * The hub's own access checks never consult this queue — those read the
 * database, so what somebody can see *on the hub* changes the instant Save
 * returns. The queue is only about Drive catching up.
 */

/** Documents in the queue: marked, and actually pushable to Drive. */
const QUEUED = {
  sharingDirtyAt: { not: null },
  googleFileId: { not: null },
  docType: { not: "LINK" },
} satisfies Prisma.DocumentWhereInput;

/** What syncSharing needs, and nothing more. */
const SHARABLE_SELECT = {
  id: true,
  visibility: true,
  source: true,
  creatorId: true,
  categoryId: true,
  productionId: true,
  editAccess: true,
  googleFileId: true,
  docType: true,
} satisfies Prisma.DocumentSelect;

/** Documents a pass could ever have to touch. */
const SHARABLE = {
  googleFileId: { not: null },
  docType: { not: "LINK" },
} satisfies Prisma.DocumentWhereInput;

/** How many documents one slice of the drain pushes. */
export const SHARING_CHUNK = 12;

/**
 * How long a background drain may run for.
 *
 * `after()` work is still part of the serverless invocation, so this stays
 * inside the platform's default ceiling. Whatever is left over is still marked,
 * so the next nudge — a page, a later save, the scheduled run — picks it up
 * exactly where this stopped.
 */
const BACKGROUND_BUDGET_MS = 25_000;

export type SharingProgress = {
  /** Documents whose Drive permissions are still out of date. */
  pending: number;
  /** Documents pushed since this pass began. */
  done: number;
  /** The denominator for a progress bar: pending + done. */
  total: number;
  /** Whether a pass is in flight at all. */
  running: boolean;
};

export type SharingDrainResult = SharingProgress & {
  /** Documents this call pushed. */
  processed: number;
  /** Of those, how many Drive refused. */
  failures: number;
};

/**
 * When the current pass started, marking one as started if it has not been.
 *
 * The anchor is what turns "still waiting" into "so many of so many", because
 * anything pushed since the pass began is finished work. Read straight from
 * the row rather than through getConfig, which is memoised per request and
 * would hand back the value from before this queued anything.
 */
async function beginPass(): Promise<Date> {
  const row = await prisma.orgConfig.findUnique({
    where: { id: "singleton" },
    select: { sharingSweepStartedAt: true },
  });
  if (row?.sharingSweepStartedAt) return row.sharingSweepStartedAt;
  const updated = await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: { sharingSweepStartedAt: new Date() },
    select: { sharingSweepStartedAt: true },
  });
  return updated.sharingSweepStartedAt ?? new Date();
}

/**
 * Mark documents as needing their Drive permissions pushed again.
 *
 * `urgent` backdates the mark so it drains ahead of anything already waiting.
 * That is for access being taken *away* — somebody removed from a show, a
 * member disabled — where the hub has already stopped listing the document and
 * the only thing outstanding is Drive still allowing it to be opened. Granting
 * access can wait its turn; revoking should not.
 */
async function queueSharing(
  where: Prisma.DocumentWhereInput,
  options?: { urgent?: boolean; metadata?: boolean },
): Promise<number> {
  const markedAt = options?.urgent ? new Date(0) : new Date();
  const { count } = await prisma.document.updateMany({
    where: { ...SHARABLE, ...where },
    data: { sharingDirtyAt: markedAt, sharingVersion: { increment: 1 },
      ...(options?.metadata ? { driveMetadataDirty: true } : {}) },
  });
  if (count > 0) await beginPass();
  return count;
}

/**
 * Every potentially affected file after a membership or role change.
 *
 * Organisation-wide documents are included because active production roles
 * also grant access to eligible categories outside a particular show.
 *
 * Private creators and named shares also depend on membership, so visibility
 * cannot narrow this sweep. With no production given, reconcile every file.
 */
export function queueCompanySharing(
  options: { productionId?: string; urgent?: boolean } = {},
): Promise<number> {
  return queueSharing(
    {
      ...(options.productionId
        ? { OR: [{ productionId: options.productionId }, { productionId: null }] }
        : {}),
    },
    { urgent: options.urgent },
  );
}

/**
 * Every document the hub shares with anybody. Used when the board's own
 * membership changes — board documents carry a permission per member — and by
 * the admin button that re-pushes the lot.
 */
export function queueAllSharing(options?: { urgent?: boolean }): Promise<number> {
  return queueSharing({}, options);
}

/** Queue one document after its audience changes. */
export function queueDocumentSharing(id: string, options?: { metadata?: boolean }): Promise<number> {
  return queueSharing({ id }, options);
}

/** How much of the current pass is left. */
export async function sharingProgress(): Promise<SharingProgress> {
  const row = await prisma.orgConfig.findUnique({
    where: { id: "singleton" },
    select: { sharingSweepStartedAt: true },
  });
  const since = row?.sharingSweepStartedAt ?? null;

  const [pending, done] = await Promise.all([
    prisma.document.count({ where: QUEUED }),
    since
      ? prisma.document.count({
          where: { ...SHARABLE, sharingDirtyAt: null, sharingSyncedAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  return { pending, done, total: pending + done, running: pending > 0 };
}

/**
 * Push one slice of the queue.
 *
 * Failures remain queued for retry, with a brief backoff so untouched files
 * can continue. Error state is retained for the admin and document pages.
 */
export async function drainSharingSlice(options?: {
  chunk?: number;
  deadline?: number;
}): Promise<SharingDrainResult> {
  const batch = await prisma.document.findMany({
    where: { AND: [QUEUED, { OR: [
      { sharingError: null },
      { sharingAttemptedAt: null },
      { sharingAttemptedAt: { lt: new Date(Date.now() - 60_000) } },
    ] }, { OR: [
      { sharingLockToken: null }, { sharingLockExpiresAt: null },
      { sharingLockExpiresAt: { lt: new Date() } },
    ] }] },
    select: SHARABLE_SELECT,
    orderBy: [{ sharingAttemptedAt: { sort: "asc", nulls: "first" } }, { sharingDirtyAt: "asc" }, { id: "asc" }],
    take: options?.chunk ?? SHARING_CHUNK,
  });

  let failures = 0;
  let processed = 0;
  for (const document of batch) {
    if (options?.deadline && Date.now() >= options.deadline) break;
    try {
      const result = await syncSharing(document, { queued: true });
      if (!result.deferred) {
        processed += 1;
        if (result.warnings.length) failures += 1;
      }
    } catch (error) {
      failures += 1;
      console.error("[sharing] could not push", document.id, error);
      await prisma.document.updateMany({ where: { id: document.id, sharingLockToken: null }, data: {
        sharingSyncedAt: null, sharingAttemptedAt: new Date(), sharingError: "Sharing failed; retry pending.",
      } }).catch(() => {});
    }
  }

  const progress = await sharingProgress();
  // Nothing left: close the pass, so the next change starts a fresh
  // denominator rather than measuring itself against this one.
  if (progress.pending === 0) {
    await prisma.orgConfig
      .update({ where: { id: "singleton" }, data: { sharingSweepStartedAt: null } })
      .catch(() => {});
  }

  return { ...progress, processed, failures };
}

/** Slice after slice until the queue is empty or the time is up. */
export async function drainSharingQueue(options?: {
  chunk?: number;
  /** `Date.now()` value to stop at. */
  deadline?: number;
}): Promise<SharingDrainResult> {
  const deadline = options?.deadline ?? Date.now() + BACKGROUND_BUDGET_MS;
  let processed = 0;
  let failures = 0;
  let last: SharingDrainResult | null = null;

  while (Date.now() < deadline) {
    const slice = await drainSharingSlice({ chunk: options?.chunk, deadline });
    processed += slice.processed;
    failures += slice.failures;
    last = slice;
    if (slice.processed === 0 || slice.pending === 0) break;
  }

  const progress = last ?? (await sharingProgress());
  return { ...progress, processed, failures };
}

/**
 * Drain the queue after the response has gone out.
 *
 * `after()` is what makes the save feel instant: the work runs in the same
 * invocation but once the browser already has its answer. It only works inside
 * a request, so a caller outside one — a script, a test — is caught here and
 * the queue simply waits for the next nudge instead of the call throwing.
 */
export function kickSharingQueue(options?: { budgetMs?: number }): void {
  try {
    after(async () => {
      try {
        await beginPass();
        await drainSharingQueue({ deadline: Date.now() + (options?.budgetMs ?? BACKGROUND_BUDGET_MS) });
      } catch (error) {
        console.error("[sharing] background drain failed", error);
      }
    });
  } catch (error) {
    console.error("[sharing] could not schedule a background drain", error);
  }
}
