"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icons";
import { cn } from "@/lib/utils";
import { CREATABLE_DOC_TYPES, DOC_TYPE_META, VISIBILITIES, VISIBILITY_META } from "@/lib/constants";

type Option = { value: string; label: string };

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

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const select =
    "rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200";

  const activeCount = ["category", "production", "type", "visibility", "mine", "status"].filter(
    (key) => params.get(key),
  ).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
        <Icon name="filter" className="size-3.5" />
        Filter
      </span>

      {!lockedCategory ? (
        <select
          aria-label="Category"
          className={select}
          value={params.get("category") ?? "all"}
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
          value={params.get("production") ?? "all"}
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
        value={params.get("type") ?? "all"}
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
          value={params.get("visibility") ?? "all"}
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
        onClick={() => update("mine", params.get("mine") ? "" : "1")}
        className={cn(
          "rounded-lg border px-2.5 py-1.5 text-sm transition",
          params.get("mine")
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
        )}
      >
        Filed by me
      </button>

      <button
        type="button"
        onClick={() => update("status", params.get("status") === "ARCHIVED" ? "" : "ARCHIVED")}
        className={cn(
          "rounded-lg border px-2.5 py-1.5 text-sm transition",
          params.get("status") === "ARCHIVED"
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
        )}
      >
        Archived
      </button>

      <select
        aria-label="Sort"
        className={cn(select, "ml-auto")}
        value={params.get("sort") ?? "updated"}
        onChange={(event) => update("sort", event.target.value)}
      >
        <option value="updated">Recently updated</option>
        <option value="created">Newest first</option>
        <option value="title">Name A–Z</option>
      </select>

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams();
            const query = params.get("q");
            if (query) next.set("q", query);
            router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
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
