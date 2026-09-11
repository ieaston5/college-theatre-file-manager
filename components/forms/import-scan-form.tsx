"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { diagnoseFolderAction, startScanAction } from "@/app/actions/import";
import { emptyState } from "@/app/actions/shared";
import { Field, inputClass } from "../ui";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export type ScannableSharedDrive = { id: string; name: string };

export function ImportScanForm({
  hubAccountEmail,
  driveMode,
  rootFolderId,
  sharedDrives,
}: {
  hubAccountEmail: string | null;
  driveMode: "google" | "mock";
  rootFolderId: string | null;
  /** Shared drives the hub's account is a member of. */
  sharedDrives: ScannableSharedDrive[];
}) {
  const [state, formAction] = useActionState(startScanAction, emptyState);
  const [checkState, checkAction] = useActionState(diagnoseFolderAction, emptyState);
  const folderInput = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="space-y-4">
      <FormBanner state={state} />
      <FormBanner state={checkState} />

      <Field
        label="Drive folder or shared drive"
        htmlFor="folder"
        required
        hint={
          driveMode === "mock"
            ? "On the simulated Drive, use a /mock-drive/<id> link or a bare folder id — the sample mess below gives you one."
            : hubAccountEmail
              ? `Share the folder with ${hubAccountEmail} first — view access is enough to scan it. A shared drive works too: make that address a member of the drive, then paste the drive's link or pick it below.`
              : "Connect the hub's Google account before scanning."
        }
      >
        <input
          id="folder"
          name="folder"
          ref={folderInput}
          className={inputClass}
          placeholder={
            driveMode === "mock"
              ? "fld_… or /mock-drive/fld_…"
              : "https://drive.google.com/drive/folders/…"
          }
          required
        />
      </Field>

      {/* Shared drives have no "shared with me" entry to find them by, so
          without this an admin has to go and dig the link out of Drive. */}
      {sharedDrives.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-500">Shared drives the hub can read:</span>
          {sharedDrives.map((drive) => (
            <button
              key={drive.id}
              type="button"
              onClick={() => {
                if (!folderInput.current) return;
                folderInput.current.value = drive.id;
                folderInput.current.focus();
              }}
              className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700 hover:bg-ink-200"
              title="Scan this whole shared drive"
            >
              {drive.name}
            </button>
          ))}
        </div>
      ) : null}

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
