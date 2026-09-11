"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { diagnoseFolderAction, scanProgressAction, startScanAction } from "@/app/actions/import";
import { emptyState } from "@/app/actions/shared";
import { Field, inputClass } from "../ui";
import { ProgressBar } from "../progress";
import { pluralize } from "@/lib/utils";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export type ScannableSharedDrive = { id: string; name: string };

/** An id for a scan the page can follow. Only ever needs to be unique. */
function newScanId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `scan${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

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
  const [state, formAction, scanning] = useActionState(startScanAction, emptyState);
  const [checkState, checkAction] = useActionState(diagnoseFolderAction, emptyState);
  const folderInput = useRef<HTMLInputElement>(null);

  /**
   * The id this scan will be filed under, generated here.
   *
   * A scan of a real club folder is a minute of Google calls, and the request
   * cannot report on itself while it is still open. Choosing the id up front
   * means the page has something to ask about: the walk writes each file down
   * as it finds it, so a poll can say how many there are so far. There is no
   * total to compare it against — Drive does not say how many files are in a
   * folder until you have walked it — so this is a count and a live bar rather
   * than a fake percentage.
   */
  const [scanId, setScanId] = useState("");
  const [found, setFound] = useState(0);
  const [folderName, setFolderName] = useState<string | null>(null);

  // Generated after mount rather than during the render, so the server's HTML
  // and the browser's first render agree on an empty field.
  useEffect(() => setScanId(newScanId()), []);

  // A fresh id once a scan has finished, ready for the next one.
  const wasScanning = useRef(false);
  useEffect(() => {
    if (wasScanning.current && !scanning) setScanId(newScanId());
    wasScanning.current = scanning;
  }, [scanning]);

  useEffect(() => {
    if (!scanning || !scanId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setFound(0);
    setFolderName(null);

    async function poll() {
      try {
        const progress = await scanProgressAction(scanId);
        if (cancelled) return;
        setFound(progress.found);
        setFolderName(progress.folderName);
      } catch {
        // Nothing to say here: the scan's own answer is what matters, and this
        // is only the commentary while it runs.
      }
      if (!cancelled) timer = setTimeout(poll, 1200);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanning, scanId]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="scanId" value={scanId} />
      <FormBanner state={state} />
      <FormBanner state={checkState} />

      {scanning ? (
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <ProgressBar
            value={found}
            label={
              found > 0
                ? `Reading ${folderName ?? "Drive"} — ${found} ${pluralize(
                    found,
                    "file",
                  )} so far`
                : `Opening ${folderName ?? "the folder"} in Drive`
            }
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            A folder does not say how many files are in it until it has been walked, so there is no
            percentage to give — this is the count as they are found, up to the 400 a scan takes.
            Nothing is filed by scanning.
          </p>
        </div>
      ) : null}

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
