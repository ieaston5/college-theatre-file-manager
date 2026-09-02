"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { cn } from "@/lib/utils";

/** Search box that navigates to /documents?q=… (debounced). */
export function SearchField({
  className,
  placeholder = "Search documents, productions, tags…",
  autoFocus = false,
}: {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  // Keep the box in step when the URL changes underneath us.
  useEffect(() => {
    setValue(params.get("q") ?? "");
  }, [params]);

  return (
    <form
      className={cn("relative", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(query ? `/documents?q=${encodeURIComponent(query)}` : "/documents");
      }}
      role="search"
    >
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
      />
      <input
        type="search"
        name="q"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label="Search documents"
        className="w-full rounded-lg border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
    </form>
  );
}
