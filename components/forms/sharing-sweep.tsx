"use client";

import { useState, useTransition } from "react";
import { reshareEverythingAction, type SharingProgress } from "@/app/actions/sharing";
import { useSharingCatchUp } from "../sharing-catch-up";
import { ProgressBar } from "../progress";
import { buttonClass } from "../ui";
import { Icon } from "../icons";
import { pluralize } from "@/lib/utils";

/**
 * The admin view of the re-share queue.
 *
 * Nothing here is normally necessary: every change that moves access queues the
 * documents it affects and the queue drains itself behind the response. This
 * page is for the two cases that are left — watching a big catch-up finish, and
 * pushing everything again after a Google call failed earlier or the group
 * address changed.
 *
 * It shares its loop with the banner people see on a production's company page
 * (see components/sharing-catch-up), so "watching" is the same thing in both
 * places: ask for a slice, show how far it has got, repeat.
 */
export function SharingSweep({ initial }: { initial: SharingProgress }) {
  const { progress, total, done, failures, stopped, pump } = useSharingCatchUp(initial);
  const [queueing, startQueueing] = useTransition();
  const [queued, setQueued] = useState(false);

  const finished = progress.pending === 0;

  return (
    <div className="space-y-3">
      {total > 0 ? (
        <ProgressBar
          value={done}
          max={total}
          tone={finished ? "emerald" : "brand"}
          label={`${done} of ${total} ${pluralize(total, "document")} re-shared${
            failures > 0 ? ` · ${failures} Drive refused` : ""
          }`}
        />
      ) : null}

      {stopped && !finished ? (
        <p className="text-xs text-amber-700">
          Paused with {progress.pending} still queued — press below to carry on, or leave it to the
          scheduled run.
        </p>
      ) : null}

      {finished && (done > 0 || queued) ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <Icon name="check-circle" className="size-3.5" />
          Everything in Drive matches the hub.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!finished ? (
          <button
            type="button"
            onClick={() => void pump()}
            className={buttonClass("primary")}
          >
            <Icon name="refresh" className="size-4" />
            Carry on with {progress.pending} {pluralize(progress.pending, "document")}
          </button>
        ) : (
          <button
            type="button"
            disabled={queueing}
            onClick={() =>
              startQueueing(async () => {
                await reshareEverythingAction();
                setQueued(true);
                // The queue is full again; the shared loop takes it from here.
                void pump();
              })
            }
            className={buttonClass("secondary")}
          >
            <Icon name="refresh" className={queueing ? "size-4 animate-spin" : "size-4"} />
            {queueing ? "Queueing…" : "Re-share everything anyway"}
          </button>
        )}
      </div>
    </div>
  );
}
