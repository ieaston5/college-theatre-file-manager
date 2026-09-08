"use client";

import { useActionState, useState, useTransition } from "react";
import { auditGroupAction, sweepSharingAction, type SweepProgress } from "@/app/actions/sharing";
import { emptyState } from "@/app/actions/shared";
import { Field, buttonClass, inputClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton } from "./form-bits";
import { pluralize } from "@/lib/utils";

/**
 * Runs the re-share sweep a slice at a time, calling back until nothing is
 * left. Per-member sharing means hundreds of Google calls for a season's
 * documents, so this is deliberately incremental and interruptible rather
 * than one request that would time out.
 */
export function SharingSweep({
  running,
  remaining,
  total,
}: {
  running: boolean;
  remaining: number;
  total: number;
}) {
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<SweepProgress | null>(
    running ? { processed: 0, remaining, total, failures: 0, started: true } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [failures, setFailures] = useState(0);

  async function loop() {
    setError(null);
    setStopped(false);
    let guard = 0;
    let totalFailures = 0;

    // The guard is a belt-and-braces stop: 200 slices of 12 is 2,400
    // documents, well beyond anything a club will have.
    while (guard < 200) {
      guard += 1;
      let slice: SweepProgress;
      try {
        slice = await sweepSharingAction();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The sweep failed.");
        return;
      }
      totalFailures += slice.failures;
      setFailures(totalFailures);
      setProgress(slice);
      if (slice.remaining === 0 || slice.processed === 0) return;
    }
    setStopped(true);
  }

  const current = progress;
  const done = current ? current.total - current.remaining : 0;
  const percent = current && current.total > 0 ? Math.round((done / current.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {current && current.total > 0 ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-ink-600">
            <span>
              {done} of {current.total} {pluralize(current.total, "document")} re-shared
              {failures > 0 ? ` · ${failures} failed` : ""}
            </span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className={
                current.remaining === 0
                  ? "h-full rounded-full bg-emerald-500 transition-all"
                  : "h-full rounded-full bg-brand-500 transition-all"
              }
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {stopped ? (
        <p className="text-xs text-amber-700">
          Stopped after a lot of slices — press it again to carry on.
        </p>
      ) : null}
      {current?.remaining === 0 && current.total > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <Icon name="check-circle" className="size-3.5" />
          Everything in Drive matches the hub.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => startTransition(loop)}
        disabled={pending}
        className={buttonClass(remaining > 0 || running ? "primary" : "secondary")}
      >
        <Icon name="refresh" className={pending ? "size-4 animate-spin" : "size-4"} />
        {pending
          ? "Re-sharing…"
          : remaining > 0 || running
            ? `Re-share ${remaining} ${pluralize(remaining, "document")}`
            : "Re-share everything anyway"}
      </button>
    </div>
  );
}

/** Paste the Google Group's member list; see both sides of the difference. */
export function GroupAuditForm() {
  const [state, formAction] = useActionState(auditGroupAction, emptyState);

  return (
    <form action={formAction} className="space-y-3">
      <FormBanner state={state} />
      <Field
        label="The group's current members"
        htmlFor="members"
        hint="There is no API for a consumer Google Group's membership, so this is a paste job: open the group at groups.google.com → Members, copy the addresses, drop them here."
      >
        <textarea
          id="members"
          name="members"
          rows={4}
          className={`${inputClass} font-mono text-xs`}
          placeholder={"someone@gmail.com\nsomeone.else@gmail.com"}
          required
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary" icon="shield" pendingLabel="Comparing…">
          Compare with the hub
        </SubmitButton>
      </div>
    </form>
  );
}
