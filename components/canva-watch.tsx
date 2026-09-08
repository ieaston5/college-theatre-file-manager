"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshCanvaOnOpenAction } from "@/app/actions/canva";
import { Icon } from "./icons";

/**
 * Asks Canva whether this design has moved on, once, when the page opens.
 *
 * The scheduled job cannot be relied on for freshness — on a free Vercel plan
 * it runs once a day — so the page checks for itself at the moment somebody is
 * about to use the copy. The server action does the deciding and the
 * throttling; this component only starts it and reports what happened.
 *
 * Asked once per document per page load: after an export the action revalidates
 * and the router refresh re-renders this component, and `asked` keeps that from
 * turning into a loop.
 */
export function CanvaWatch({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "checking" | "exported" | "done">("idle");

  useEffect(() => {
    let cancelled = false;
    let asked = false;

    // A beat of delay so the check never competes with the page's own render.
    const timer = setTimeout(async () => {
      if (asked) return;
      asked = true;
      if (!cancelled) setState("checking");

      const result = await refreshCanvaOnOpenAction(documentId);
      if (cancelled) return;

      if (result.exported) {
        setState("exported");
        router.refresh();
        return;
      }
      // A check that found a change still needs a re-render to show the banner.
      if (result.checked) router.refresh();
      setState("done");
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId, router]);

  if (state === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <Icon name="clock" className="size-3.5 animate-pulse" />
        Checking Canva for changes…
      </p>
    );
  }

  if (state === "exported") {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-green-700">
        <Icon name="check-circle" className="size-3.5" />
        The design had moved on, so the hub took a fresh copy just now.
      </p>
    );
  }

  return null;
}
