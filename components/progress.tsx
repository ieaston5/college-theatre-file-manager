import { cn } from "@/lib/utils";

/**
 * A progress bar for work that reports real progress.
 *
 * Everything slow in the hub is slow for the same reason — it is one Google
 * call per file, or per person per file — which means every one of them can
 * count what it has done and what is left. A spinner on a button says only
 * "still going"; these say how far, which is the difference between waiting
 * and wondering whether it has hung.
 *
 * `max` of zero means the total is genuinely unknown — a Drive folder does not
 * tell you how many files are in it until you have walked it — so the bar
 * becomes an indeterminate one and the label carries the running count. That is
 * the honest shape for a scan, and it is never used to fake a percentage.
 */
export function ProgressBar({
  value,
  max,
  label,
  hint,
  tone = "brand",
  className,
}: {
  value: number;
  /** Zero or undefined for work whose total cannot be known yet. */
  max?: number;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "brand" | "emerald" | "amber";
  className?: string;
}) {
  const indeterminate = !max || max <= 0;
  const percent = indeterminate ? 0 : Math.min(100, Math.round((value / max) * 100));
  const done = !indeterminate && value >= max;

  const fill =
    done || tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-brand-500";

  return (
    <div className={className}>
      {label || hint ? (
        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-ink-600">
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 tabular-nums text-ink-500">
            {hint ?? (indeterminate ? null : `${percent}%`)}
          </span>
        </div>
      ) : null}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-ink-100"
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuetext={
          indeterminate ? `${value} so far` : `${value} of ${max}`
        }
      >
        {indeterminate ? (
          // A bar that cannot know its end still has to show it is alive.
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-400" />
        ) : (
          <div
            className={cn("h-full rounded-full transition-all duration-300", fill)}
            // A sliver at zero, so the bar reads as "started" rather than
            // "nothing happening".
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        )}
      </div>
    </div>
  );
}
