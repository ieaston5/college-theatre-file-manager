import Link from "next/link";
import type { SearchParams } from "@/lib/queries";
import { buttonClass } from "./ui";

export function DocumentPagination({ pathname, params, page, pageSize, total }: {
  pathname: string; params: SearchParams; page: number; pageSize: number; total: number;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  function href(target: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && key !== "page") {
        for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
      }
    }
    query.set("page", String(target));
    return `${pathname}?${query}`;
  }
  return (
    <nav aria-label="Document pages" className="my-5 flex items-center justify-center gap-4">
      {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary")}>Previous</Link> : null}
      <span className="text-sm text-ink-600">Page {page} of {pages} · {total} documents</span>
      {page < pages ? <Link href={href(page + 1)} className={buttonClass("secondary")}>Next</Link> : null}
    </nav>
  );
}
