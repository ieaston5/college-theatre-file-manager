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
 * pushing a document's sharing is idempotent, so the worst a double-drain costs
 * is a repeated Drive call.
 *
 * The hub's own access checks never consult this queue — those read the
 * database, so what somebody can see *on the hub* changes the instant Save
 * returns. The queue is only about Drive catching up.
 */

/** Documents in the queue: marked, and actually pushable to Drive. */
const QUEUED = {
  sharingDirtyAt: { not: null },
  status: "ACTIVE",
  googleFileId: { not: null },
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
  status: "ACTIVE",
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
  options?: { urgent?: boolean },
): Promise<number> {
  const markedAt = options?.urgent ? new Date(0) : new Date();
  const { count } = await prisma.document.updateMany({
    where: { ...SHARABLE, ...where },
    data: { sharingDirtyAt: markedAt },
  });
  if (count > 0) await beginPass();
  return count;
}

/**
 * Everything a production's company can see, after a membership or role change.
 *
 * Documents filed against no show are included even though no company can see
 * them: a company document needs a production, so anything left over from
 * before that rule has Drive grants to hand back, and the reconciling sync is
 * what takes them off.
 *
 * With no production given, every company document on the hub — which is what
 * a change to a role's categories means, since a role is used by every show.
 */
export function queueCompanySharing(
  options: { productionId?: string; urgent?: boolean } = {},
): Promise<number> {
  return queueSharing(
    {
      visibility: "COMPANY",
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
  return queueSharing({ visibility: { not: "PRIVATE" } }, options);
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
 * A failure marks the document done anyway. One file the hub cannot share —
 * somebody else owns it and has since restricted it — must not stall everything
 * behind it, and the admin page lists what never made it to Drive separately.
 */
export async function drainSharingSlice(options?: {
  chunk?: number;
}): Promise<SharingDrainResult> {
  const batch = await prisma.document.findMany({
    where: QUEUED,
    select: SHARABLE_SELECT,
    orderBy: { sharingDirtyAt: "asc" },
    take: options?.chunk ?? SHARING_CHUNK,
  });

  let failures = 0;
  for (const document of batch) {
    try {
      await syncSharing(document);
    } catch (error) {
      failures += 1;
      console.error("[sharing] could not push", document.id, error);
    } finally {
      await prisma.document
        .update({ where: { id: document.id }, data: { sharingDirtyAt: null } })
        .catch(() => {});
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

  return { ...progress, processed: batch.length, failures };
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
    const slice = await drainSharingSlice({ chunk: options?.chunk });
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
  const deadline = Date.now() + (options?.budgetMs ?? BACKGROUND_BUDGET_MS);
  try {
    after(async () => {
      try {
        await drainSharingQueue({ deadline });
      } catch (error) {
        console.error("[sharing] background drain failed", error);
      }
    });
  } catch (error) {
    console.error("[sharing] could not schedule a background drain", error);
  }
}
