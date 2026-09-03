"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { uploadFile } from "@/lib/upload-client";
import { buttonClass } from "../ui";
import { Icon } from "../icons";
import { FilePicker, fileKey, type UploadState } from "./file-picker";

/**
 * Replaces the contents of an uploaded file, keeping the same Drive file — so
 * every link already handed out still works and Drive keeps the old revision.
 * This is the hub's answer to "Script_FINAL_v3.pdf".
 */
export function NewVersionUploader({
  documentId,
  currentFileName,
}: {
  documentId: string;
  currentFileName: string | null;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadState>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function upload() {
    if (files.length === 0) return;
    const file = files[0];
    const key = fileKey(file);
    setError(null);
    setBusy(true);
    setProgress({ [key]: { pct: 0, status: "uploading" } });

    try {
      await uploadFile({
        file,
        start: { mode: "version", documentId },
        onProgress: (pct) => setProgress({ [key]: { pct, status: "uploading" } }),
      });
      setProgress({ [key]: { pct: 100, status: "done" } });
      setDone(true);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The upload failed.";
      setProgress({ [key]: { pct: 100, status: "error", error: message } });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <Icon name="check-circle" className="size-4 shrink-0" />
        <span className="flex-1">
          New version uploaded. The link is unchanged and Drive kept the previous version in its
          revision history.
        </span>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setFiles([]);
            setProgress({});
          }}
          className="text-xs font-medium underline"
        >
          Upload another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FilePicker
        files={files}
        onFiles={setFiles}
        onRemove={() => setFiles([])}
        progress={progress}
        multiple={false}
        disabled={busy}
        hint={
          currentFileName
            ? `Replaces the contents of ${currentFileName}. The link, name and sharing stay the same.`
            : "Replaces the file's contents. The link, name and sharing stay the same."
        }
      />
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={upload}
          disabled={busy || files.length === 0}
          className={buttonClass("secondary")}
        >
          <Icon name={busy ? "refresh" : "upload"} className={busy ? "size-4 animate-spin" : "size-4"} />
          {busy ? "Uploading…" : "Upload new version"}
        </button>
      </div>
    </div>
  );
}
