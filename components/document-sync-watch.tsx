"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh the status after background work, without holding a form open. */
export function DocumentSyncWatch({ id, failed }: { id: string; failed: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/documents/${encodeURIComponent(id)}/sync-status`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) { if (response.status === 401 || response.status === 404) router.refresh(); return; }
        const status: { pending: boolean; failed: boolean } = await response.json();
        if (controller.signal.aborted) return;
        if (!status.pending || status.failed !== failed) { router.refresh(); return; }
        if (++attempts < 90) timer = setTimeout(poll, 2_000);
      } catch { /* The saved queue will retry even when this page is offline. */ }
    }
    timer = setTimeout(poll, 1_000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, failed, router]);
  return null;
}
