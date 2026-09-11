import { DocumentList, type DocumentListItem } from "./document-items";
import { Badge } from "./ui";
import { pluralize } from "@/lib/utils";

/**
 * A document list that arrives after the page around it.
 *
 * Every list page reads the session cookie, so it renders dynamically, and
 * until now each one awaited its query before sending a single byte: changing a
 * filter left the previous page on screen — filter bar, heading, old results —
 * with nothing moving until the whole render was done. The queries are two
 * indexed reads, so what people were waiting on was mostly a round trip they
 * could not see happening.
 *
 * Handing the promise down instead lets the page send its frame immediately and
 * stream the rows in behind a boundary. Two things make that work:
 *
 *  - the query is started in the page and *not* awaited there, so the heading,
 *    the filters and the sidebar paint at once;
 *  - the boundary is keyed on the filters, so React shows the skeleton for a
 *    new set of filters rather than holding the old rows. Without the key a
 *    transition keeps the previous content on screen — correct for a refresh,
 *    wrong here, because the whole point is to show that the click landed.
 *
 * The same promise feeds the count, so asking for both costs one query.
 */

export type DocumentQuery = Promise<{ documents: DocumentListItem[]; total: number }>;

export async function DocumentResults({
  query,
  showCategory,
  showProduction,
  showPinned,
  empty,
}: {
  query: DocumentQuery;
  showCategory?: boolean;
  showProduction?: boolean;
  showPinned?: boolean;
  empty?: React.ReactNode;
}) {
  const { documents } = await query;
  return (
    <DocumentList
      documents={documents}
      showCategory={showCategory}
      showProduction={showProduction}
      showPinned={showPinned}
      empty={empty}
    />
  );
}

/** "12 documents", once the count is in. */
export async function DocumentTotal({ query }: { query: DocumentQuery }) {
  const { total } = await query;
  return (
    <Badge tone="slate">
      {total} {pluralize(total, "document")}
    </Badge>
  );
}

/** "12 documents you can see." — the count as a sentence, for a page heading. */
export async function DocumentTotalSentence({ query }: { query: DocumentQuery }) {
  const { total } = await query;
  return (
    <>
      {total} {pluralize(total, "document")} you can see.
    </>
  );
}

/** "Showing the first 100 of 340", when the list was capped. */
export async function DocumentTotalNote({ query }: { query: DocumentQuery }) {
  const { total, documents } = await query;
  if (total <= documents.length) return null;
  return (
    <p className="mt-4 text-center text-xs text-ink-400">
      Showing the first {documents.length} of {total}. Narrow the filters to see the rest.
    </p>
  );
}

function Line({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-ink-100 ${className}`} />;
}

/** The shape of a list on its way. Deliberately the same as app/(app)/loading. */
export function DocumentResultsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card animate-pulse divide-y divide-ink-100 p-0" aria-busy="true">
      <span className="sr-only">Loading documents…</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3">
          <Line className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Line className="h-4 w-1/3 min-w-32" />
            <Line className="h-3 w-1/2 min-w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One string that changes whenever the filters do, for keying the boundary.
 *
 * Only the parameters that change what the list contains: a filter change
 * should show the skeleton, while something unrelated in the URL should not.
 */
export function filterKey(params: Record<string, string | string[] | undefined>): string {
  return ["q", "category", "production", "type", "visibility", "mine", "status", "sort"]
    .map((key) => {
      const value = params[key];
      return `${key}=${Array.isArray(value) ? value.join(",") : (value ?? "")}`;
    })
    .join("&");
}
