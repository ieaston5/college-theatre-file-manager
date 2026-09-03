"use client";

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { cn, formatBytes } from "@/lib/utils";
import { UPLOAD_MAX_BYTES } from "@/lib/constants";

export type UploadState = {
  pct: number;
  status: "waiting" | "uploading" | "done" | "error";
  error?: string;
  documentId?: string;
};

/**
 * Drag-and-drop plus a normal file button. Kept dumb: the parent owns the file
 * list and the upload state, so the same picker works for a new document and
 * for replacing an existing one.
 */
export function FilePicker({
  files,
  onFiles,
  onRemove,
  progress,
  multiple = true,
  disabled = false,
  hint,
}: {
  files: File[];
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  progress?: Record<string, UploadState>;
  multiple?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tooBig, setTooBig] = useState<string[]>([]);

  function accept(incoming: FileList | null) {
    if (!incoming) return;
    const list = Array.from(incoming);
    const oversized = list.filter((file) => file.size > UPLOAD_MAX_BYTES).map((file) => file.name);
    setTooBig(oversized);
    const usable = list.filter((file) => file.size <= UPLOAD_MAX_BYTES);
    if (usable.length > 0) onFiles(multiple ? [...files, ...usable] : usable.slice(0, 1));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) accept(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 text-center transition",
          dragging ? "border-brand-500 bg-brand-50" : "border-ink-300 bg-white",
          disabled && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-ink-100 text-ink-500">
          <Icon name="upload" className="size-5" />
        </span>
        <p className="text-sm font-medium text-ink-800">
          Drag {multiple ? "files" : "a file"} here, or{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700"
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          {hint ?? "Any file type — PDFs, scans, images, spreadsheets, audio."} Up to{" "}
          {formatBytes(UPLOAD_MAX_BYTES)} each.
        </p>
      </div>

      {tooBig.length > 0 ? (
        <p className="text-xs text-rose-700">
          Too large to upload: {tooBig.join(", ")}. Put it in Drive by hand and use “Add existing”
          instead.
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((file, index) => {
            const state = progress?.[`${file.name}:${file.size}`];
            return (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="rounded-lg border border-ink-200 bg-white p-3"
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    name={
                      state?.status === "done"
                        ? "check-circle"
                        : state?.status === "error"
                          ? "warning"
                          : "file"
                    }
                    className={cn(
                      "size-4 shrink-0",
                      state?.status === "done" && "text-emerald-600",
                      state?.status === "error" && "text-rose-600",
                      !state?.status && "text-ink-400",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {file.name}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {formatBytes(file.size)}
                      {state?.status === "uploading" ? ` · ${state.pct}%` : ""}
                      {state?.status === "done" ? " · filed" : ""}
                    </span>
                  </span>
                  {!state || state.status === "waiting" ? (
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      aria-label={`Remove ${file.name}`}
                    >
                      <Icon name="x" className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                {state && state.status !== "waiting" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        state.status === "error" ? "bg-rose-500" : "bg-brand-500",
                      )}
                      style={{ width: `${state.status === "error" ? 100 : state.pct}%` }}
                    />
                  </div>
                ) : null}

                {state?.error ? (
                  <p className="mt-1.5 text-xs text-rose-700">{state.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function fileKey(file: File) {
  return `${file.name}:${file.size}`;
}
