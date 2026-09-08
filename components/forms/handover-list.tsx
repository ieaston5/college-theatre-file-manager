"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../icons";
import { Badge, buttonClass } from "../ui";
import { pluralize } from "@/lib/utils";

/**
 * The chase-list for ownership.
 *
 * Google only lets the *current owner* hand a file over, so this is the one
 * part of an import the hub cannot finish by itself. What it can do is produce
 * a ready-to-send message per person, and shrink the list on its own as files
 * change hands — the next Drive sync notices the new owner.
 */
export function HandoverList({
  owners,
  hubAccountEmail,
}: {
  owners: Array<{ owner: string; files: Array<{ id: string; title: string }> }>;
  hubAccountEmail: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyFor(owner: string, files: Array<{ title: string }>) {
    const message = [
      `Hi — we're moving the club's files onto the hub so they stop disappearing when people graduate.`,
      ``,
      `These ${files.length} ${pluralize(files.length, "file")} are still owned by your account:`,
      ...files.map((file) => `  · ${file.title}`),
      ``,
      `Could you transfer them to ${hubAccountEmail ?? "the club account"}? In Drive: right-click the file → Share → click the dropdown next to ${hubAccountEmail ?? "the club account"} → Transfer ownership. It stays editable for you, it just stops being yours to lose.`,
      ``,
      `Thanks!`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(message);
      setCopied(owner);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied(null);
    }
  }

  const total = owners.reduce((sum, entry) => sum + entry.files.length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        {total} {pluralize(total, "file")} across {owners.length}{" "}
        {pluralize(owners.length, "person", "people")}. Transferring is worth it for anything the
        club needs next year; for the rest, leaving them where they are is fine — the hub still
        knows where they live.
      </p>

      <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
        {owners.map((entry) => (
          <li key={entry.owner} className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="mail" className="size-4 shrink-0 text-ink-400" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                {entry.owner}
              </span>
              <Badge tone="amber">
                {entry.files.length} {pluralize(entry.files.length, "file")}
              </Badge>
              <button
                type="button"
                onClick={() => copyFor(entry.owner, entry.files)}
                className={buttonClass("secondary", "text-xs")}
              >
                <Icon name={copied === entry.owner ? "check" : "copy"} className="size-3.5" />
                {copied === entry.owner ? "Copied" : "Copy the ask"}
              </button>
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {entry.files.slice(0, 8).map((file) => (
                <li key={file.id}>
                  <Link
                    href={`/documents/${file.id}`}
                    className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-200"
                  >
                    {file.title}
                  </Link>
                </li>
              ))}
              {entry.files.length > 8 ? (
                <li className="px-1 text-xs text-ink-400">
                  and {entry.files.length - 8} more
                </li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
