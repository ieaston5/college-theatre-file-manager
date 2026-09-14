"use client";

import { useState, useTransition } from "react";
import { refreshCanvaOnOpenAction } from "@/app/actions/canva";
import { Icon } from "./icons";

/** Check at the actual point of opening, including shortcuts from lists. */
export function CanvaOpenLink({ documentId, href, className, compact = false }: {
  documentId: string; href: string; className?: string; compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className} disabled={pending}
        aria-label="Check Canva and open copy" onClick={() => startTransition(async () => {
          setNotice(null);
          try {
            const result = await refreshCanvaOnOpenAction(documentId);
            if (result.error || (result.stale && !result.exported)) {
              setNotice(result.error ?? "The Canva original is newer than this copy.");
              return;
            }
            window.location.assign(href);
          } catch {
            setNotice("Could not check Canva for changes.");
          }
        })}>
        <Icon name={pending ? "clock" : "external"} className="size-4" />
        {!compact ? (pending ? "Checking Canva…" : "Open copy") : null}
      </button>
      {notice ? <span role="status" className="text-xs text-amber-800">
        {notice} <a href={href} className="underline">Open last exported copy</a>
      </span> : null}
    </span>
  );
}
