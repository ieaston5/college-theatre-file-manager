"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type TransitionStartFunction,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icons";
import { cn } from "@/lib/utils";
import { CREATABLE_DOC_TYPES, DOC_TYPE_META, VISIBILITIES, VISIBILITY_META } from "@/lib/constants";

type Option = { value: string; label: string };

/**
 * One transition shared by the filter bar and the list it filters.
 *
 * The two are siblings — the bar is a client component, the list is rendered
 * on the server — so the only thing that can tell the list "what you are
 * showing is one filter out of date" is a context around both of them. React
 * deliberately keeps already-visible content on screen through a transition
 * rather than replacing it with a skeleton, which is the right call (no jump,
 * no flash) but leaves the old rows looking current. Fading them says
 * otherwise, immediately, without moving anything.
 */
const FilteringContext = createContext<{
  pending: boolean;
  start: TransitionStartFunction;
} | null>(null);

export function FilteringProvider({ children }: { children: React.ReactNode }) {
  const [pending, start] = useTransition();
  return (
    <FilteringContext.Provider value={{ pending, start }}>{children}</FilteringContext.Provider>
  );
}

/** Wraps the list: dimmed and marked busy while a filter change is in flight. */
export function Filtered({ children }: { children: React.ReactNode }) {
  const shared = useContext(FilteringContext);
  return (
    <div
      className={cn(
        "transition-opacity duration-150",
        shared?.pending && "pointer-events-none opacity-40",
      )}
      aria-busy={shared?.pending || undefined}
    >
      {children}
    </div>
  );
}

/**
 * The filter bar.
 *
 * Filtering is a URL change, which is what makes a filtered list shareable and
 * the back button work. The cost is that the controls used to lag: a `select`
 * whose value comes from the URL does not move until the server has answered,
 * so picking "Budgets" left the dropdown showing "All categories" for as long
 * as the query took, and the list underneath sat there unchanged. Nothing was
 * slow about the query — it is two indexed reads — but the interface gave no
 * sign of having heard the click, which reads as a lag whatever the number.
 *
 * So the choice is applied here the instant it is made, and kept until the URL
 * catches up: `draft` is what the controls show while a navigation is in
 * flight. The list itself streams in behind its own boundary (see the pages
 * that render this), so the bar stays usable — two filters in quick succession
 * work, rather than the second click landing on a frozen control.
 */
export function DocumentFilters({
  categories,
  productions,
  showVisibility = true,
  boardVisibility = true,
  lockedCategory,
  lockedProduction,
}: {
  categories: Option[];
  productions: Option[];
  showVisibility?: boolean;
  /** False for company members: "Board" would only ever return nothing. */
  boardVisibility?: boolean;
  lockedCategory?: string;
  lockedProduction?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();

  // The shared transition when a page has wrapped the bar and its list in a
  // FilteringProvider; the bar's own otherwise, so it still works alone.
  const shared = useContext(FilteringContext);
  const [ownPending, ownStart] = useTransition();
  const pending = shared?.pending ?? ownPending;
  const startTransition = shared?.start ?? ownStart;

  const [draft, setDraft] = useState<string | null>(null);

  // The URL has arrived where the draft was going, so stop second-guessing it:
  // from here the URL is the truth again, including a back button press.
  useEffect(() => setDraft(null), [search]);

  const shown = new URLSearchParams(draft ?? search);
  const value = (key: string) => shown.get(key);

  function go(next: URLSearchParams) {
    const query = next.toString();
    setDraft(query);
    startTransition(() => {
      // No scroll reset: filtering is a change to the list you are already
      // looking at, and being thrown back to the top of the page is its own
      // small cost.
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function update(key: string, next: string) {
    const params = new URLSearchParams(draft ?? search);
    if (!next || next === "all") params.delete(key);
    else params.set(key, next);
    go(params);
  }

  const select =
    "rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200";

  const activeCount = ["category", "production", "type", "visibility", "mine", "status"].filter(
    (key) => value(key),
  ).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
        <Icon name={pending ? "refresh" : "filter"} className={cn("size-3.5", pending && "animate-spin")} />
        Filter
      </span>

      {!lockedCategory ? (
        <select
          aria-label="Category"
          className={select}
          value={value("category") ?? "all"}
          onChange={(event) => update("category", event.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {!lockedProduction ? (
        <select
          aria-label="Production"
          className={select}
          value={value("production") ?? "all"}
          onChange={(event) => update("production", event.target.value)}
        >
          <option value="all">All productions</option>
          <option value="none">Not tied to a show</option>
          {productions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      <select
        aria-label="File type"
        className={select}
        value={value("type") ?? "all"}
        onChange={(event) => update("type", event.target.value)}
      >
        <option value="all">Any type</option>
        {CREATABLE_DOC_TYPES.map((type) => (
          <option key={type} value={type}>
            {DOC_TYPE_META[type].label}
          </option>
        ))}
        <option value="LINK">External link</option>
        <option value="OTHER">Other file</option>
      </select>

      {showVisibility ? (
        <select
          aria-label="Visibility"
          className={select}
          value={value("visibility") ?? "all"}
          onChange={(event) => update("visibility", event.target.value)}
        >
          <option value="all">Any visibility</option>
          {VISIBILITIES.filter(
            (visibility) => boardVisibility || visibility !== "BOARD",
          ).map((visibility) => (
            <option key={visibility} value={visibility}>
              {VISIBILITY_META[visibility].label}
            </option>
          ))}
        </select>
      ) : null}

      <button
        type="button"
        onClick={() => update("mine", value("mine") ? "" : "1")}
        className={cn(
          "rounded-lg border px-2.5 py-1.5 text-sm transition",
          value("mine")
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
        )}
      >
        Filed by me
      </button>

      <button
        type="button"
        onClick={() => update("status", value("status") === "ARCHIVED" ? "" : "ARCHIVED")}
        className={cn(
          "rounded-lg border px-2.5 py-1.5 text-sm transition",
          value("status") === "ARCHIVED"
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
        )}
      >
        Archived
      </button>

      <select
        aria-label="Sort"
        className={cn(select, "ml-auto")}
        value={value("sort") ?? "updated"}
        onChange={(event) => update("sort", event.target.value)}
      >
        <option value="updated">Recently edited</option>
        <option value="created">Newest first</option>
        <option value="title">Name A–Z</option>
      </select>

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            // The search term is not a filter — it is what you are looking at.
            const next = new URLSearchParams();
            const query = value("q");
            if (query) next.set("q", query);
            go(next);
          }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-500 hover:text-ink-800"
        >
          <Icon name="x" className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
