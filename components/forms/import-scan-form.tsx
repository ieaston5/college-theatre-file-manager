"use client";

import { useActionState } from "react";
import Link from "next/link";
import { diagnoseFolderAction, startScanAction } from "@/app/actions/import";
import { emptyState } from "@/app/actions/shared";
import { Field, inputClass } from "../ui";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export function ImportScanForm({
  hubAccountEmail,
  driveMode,
  rootFolderId,
}: {
  hubAccountEmail: string | null;
  driveMode: "google" | "mock";
  rootFolderId: string | null;
}) {
  const [state, formAction] = useActionState(startScanAction, emptyState);
  const [checkState, checkAction] = useActionState(diagnoseFolderAction, emptyState);

  return (
    <form action={formAction} className="space-y-4">
      <FormBanner state={state} />
      <FormBanner state={checkState} />

      <Field
        label="Drive folder"
        htmlFor="folder"
        required
        hint={
          driveMode === "mock"
            ? "On the simulated Drive, use a /mock-drive/<id> link or a bare folder id — the sample mess below gives you one."
            : hubAccountEmail
              ? `Share the folder with ${hubAccountEmail} first — view access is enough to scan it.`
              : "Connect the hub's Google account before scanning."
        }
      >
        <input
          id="folder"
          name="folder"
          className={inputClass}
          placeholder={
            driveMode === "mock"
              ? "fld_… or /mock-drive/fld_…"
              : "https://drive.google.com/drive/folders/…"
          }
          required
        />
      </Field>

      <Toggle
        name="includeSubfolders"
        label="Look inside subfolders"
        hint="Up to four levels deep. The folder names become part of the guess, which usually helps."
        defaultChecked
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {state.documentId ? (
          <Link
            href={`/admin/import?batch=${state.documentId}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Open that scan →
          </Link>
        ) : (
          <span className="text-xs text-ink-500">
            Nothing is filed by scanning — you confirm each file afterwards.
          </span>
        )}
        <div className="flex items-center gap-2">
          {/* Asks Drive what it thinks this account can see, and writes the
              answer to the activity log. Nothing is written to Drive. */}
          <SubmitButton
            formAction={checkAction}
            variant="secondary"
            icon="info"
            pendingLabel="Asking Drive…"
          >
            Why is it empty?
          </SubmitButton>
          <SubmitButton icon="search" pendingLabel="Reading the folder…">
            Scan
          </SubmitButton>
        </div>
      </div>

      {rootFolderId ? (
        <p className="text-xs text-ink-400">
          Tip: the hub's own folder is already organised, so there is no need to scan it.
        </p>
      ) : null}
    </form>
  );
}
