"use client";

import { useActionState } from "react";
import { reexportCanvaAction } from "@/app/actions/canva";
import { emptyState } from "@/app/actions/shared";
import { Icon } from "../icons";
import { FormBanner, SubmitButton } from "./form-bits";

/**
 * The re-export control for a mirrored Canva design. Separate from the page so
 * warnings from Canva (premium elements, awaiting approval, a format that came
 * back as several files) can be shown where the person clicked.
 */
export function CanvaReexportForm({
  documentId,
  stale,
}: {
  documentId: string;
  stale: boolean;
}) {
  const [state, formAction] = useActionState(reexportCanvaAction, emptyState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={documentId} />
      <FormBanner state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          variant={stale ? "primary" : "secondary"}
          icon="refresh"
          pendingLabel="Exporting from Canva…"
        >
          {stale ? "Update the copy from Canva" : "Re-export from Canva"}
        </SubmitButton>
        {stale ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
            <Icon name="alert" className="size-3.5" />
            The design has moved on since this copy was made.
          </span>
        ) : null}
      </div>
    </form>
  );
}
