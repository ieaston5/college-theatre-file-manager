/**
 * The shape of a hub page while its data is on the way.
 *
 * This file does more than draw a skeleton. Every page here reads the session
 * cookie, so all of them render dynamically, and Next only prefetches a
 * dynamic route as far as its nearest loading boundary — with no boundary
 * anywhere in the app, hovering a link prefetched nothing and clicking one
 * left the previous page on screen, motionless, until the server had finished
 * every query. That is the "nothing happens for a second" the hub was
 * complaining of. A boundary here means the click paints immediately and the
 * page streams in behind it.
 *
 * It is deliberately generic: a title, a row of tiles and a list, which is the
 * broad shape of the dashboard, the document lists and the category and
 * production pages alike.
 */
function Line({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-ink-100 ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <Line className="h-7 w-56" />
        <Line className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="card space-y-3 p-4">
            <Line className="h-3 w-20" />
            <Line className="h-6 w-12" />
          </div>
        ))}
      </div>

      <div className="card divide-y divide-ink-100 p-0">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <Line className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Line className="h-4 w-1/3 min-w-32" />
              <Line className="h-3 w-1/2 min-w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
