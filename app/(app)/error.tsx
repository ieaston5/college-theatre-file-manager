"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What the hub shows when something throws in the browser.
 *
 * Without this, a client-side exception gives a blank page and "Application
 * error: a client-side exception has occurred" — no indication of what broke,
 * whether the work was saved, or what to do next. That happened during a real
 * import: the 27 files had been scanned and recorded, and the only thing lost
 * was the screen that said so.
 *
 * So this says three things: the work may well have completed, here is the
 * identifier that ties this to the server log, and here is the way back.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to the browser console *and* the host's log, so the two can be
    // matched up by digest afterwards.
    console.error("[hub] client error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <h1 className="text-xl font-semibold text-ink-900">This screen broke</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        Something went wrong while drawing this page. Whatever you had just asked the hub to do
        probably finished — the failure is in showing you the result, not in the work itself. Reload
        before repeating anything, so you do not do it twice.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
        >
          Back to the dashboard
        </Link>
      </div>

      <div className="mt-8 rounded-lg bg-ink-50 p-3 text-left text-xs text-ink-600">
        <div className="font-medium text-ink-700">Worth copying if you report this</div>
        <p className="mt-1 break-words font-mono">
          {error.message || "no message"}
          {error.digest ? ` · digest ${error.digest}` : ""}
        </p>
        <p className="mt-2 text-ink-500">
          The digest matches an entry in the host&rsquo;s log, which has the stack trace that this
          page deliberately does not show.
        </p>
      </div>
    </div>
  );
}
