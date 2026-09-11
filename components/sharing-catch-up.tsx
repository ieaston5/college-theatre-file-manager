"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { drainSharingAction, type SharingProgress } from "@/app/actions/sharing";
import { ProgressBar } from "./progress";
import { Icon } from "./icons";
import { pluralize } from "@/lib/utils";

/**
 * "Your change is saved; Drive is still catching up."
 *
 * An access change takes effect on the hub the moment it is saved, and takes a
 * little longer to reach Drive, because Drive needs one call per person per
 * file. Rather than hold the save until that is finished — which is what used
 * to happen, and what made changing somebody's role feel broken — the hub says
 * so: here is how much is left, it is going along on its own, and you may
 * leave.
 *
 * The banner is also a worker. While it is on screen it keeps asking for a
 * slice of the queue to be pushed, so a long catch-up visibly finishes for
 * whoever is watching instead of waiting on the next scheduled run. Closing the
 * page is safe: the drain that runs behind the save carries on regardless, and
 * the schedule is the backstop for anything still marked afterwards.
 */

/** Roughly how often to come back for the next slice. */
const GAP_MS = 600;

export function useSharingCatchUp(initial: SharingProgress) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [failures, setFailures] = useState(0);
  const [stopped, setStopped] = useState(false);
  /**
   * The largest amount of work this loop has ever seen outstanding.
   *
   * The server's denominator is "everything pushed since the pass began", and
   * the pass is closed the moment the queue empties — so a queue that finishes
   * between two polls reports nothing at all to divide by, and the bar would
   * read "0 of 0". Remembering the high-water mark keeps it counting up to a
   * number that does not move, and reading down from it is what makes the bar
   * fill rather than jump about.
   */
  const [peak, setPeak] = useState(initial.total);
  // Held in a ref so a re-render cannot start a second loop.
  const running = useRef(false);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStopped(false);
    try {
      // 200 slices of twelve is far more than any club will ever queue; the
      // guard is only here so a bug cannot spin forever.
      for (let slice = 0; slice < 200; slice += 1) {
        const next = await drainSharingAction();
        setProgress(next);
        setPeak((seen) => Math.max(seen, next.total, next.done + next.pending));
        if (next.failures > 0) setFailures((total) => total + next.failures);
        if (next.pending === 0) {
          // The lists on the page may have been waiting on this.
          router.refresh();
          return;
        }
        if (next.processed === 0) {
          // Nothing came back but the queue is not empty: something else is
          // holding the rows. Leave it to that, rather than spinning.
          setStopped(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
      setStopped(true);
    } catch {
      // Losing the connection, or the tab being suspended, is not worth an
      // error message: the work is written down and something else will
      // finish it.
      setStopped(true);
    } finally {
      running.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (!initial.running) return;
    void pump();
  }, [initial.running, pump]);

  // What to draw: the high-water mark as the total, and everything not still
  // waiting as done.
  const total = Math.max(peak, progress.total, progress.done + progress.pending);
  return { progress, total, done: total - progress.pending, failures, stopped, pump };
}

export function SharingCatchUp({ initial }: { initial: SharingProgress }) {
  const { progress, total, done, failures, stopped } = useSharingCatchUp(initial);

  if (!initial.running && !progress.running && total === 0) return null;

  const finished = progress.pending === 0;

  return (
    <div
      className={
        finished
          ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          : "rounded-xl border border-sky-200 bg-sky-50 p-4"
      }
      aria-live="polite"
    >
      <div className="mb-2 flex items-start gap-2">
        <Icon
          name={finished ? "check-circle" : "refresh"}
          className={
            finished ? "mt-0.5 size-4 shrink-0 text-emerald-700" : "mt-0.5 size-4 shrink-0 animate-spin text-sky-700"
          }
        />
        <div className="min-w-0 text-sm">
          <p className={finished ? "font-medium text-emerald-900" : "font-medium text-sky-900"}>
            {finished
              ? "Drive has caught up with the hub."
              : "Drive is catching up with the hub"}
          </p>
          {!finished ? (
            <p className="mt-0.5 text-xs leading-relaxed text-sky-900/80">
              Everyone can already see the right things on the hub — this is Drive being told, one
              file at a time. It carries on without this page, so you are free to leave.
            </p>
          ) : null}
        </div>
      </div>

      {total > 0 ? (
        <ProgressBar
          value={done}
          max={total}
          label={
            finished
              ? `${done} ${pluralize(done, "document")} re-shared`
              : `${done} of ${total} ${pluralize(total, "document")} re-shared${
                  failures > 0 ? ` · ${failures} Drive refused` : ""
                }`
          }
        />
      ) : null}

      {stopped && !finished ? (
        <p className="mt-2 text-xs text-sky-900/80">
          Still {progress.pending} to go. They are queued, and the hub picks them up on its next
          run or the next time somebody is on this page.
        </p>
      ) : null}
    </div>
  );
}
