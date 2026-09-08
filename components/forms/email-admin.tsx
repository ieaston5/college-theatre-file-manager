"use client";

import { useActionState, useState } from "react";
import { sendDigestAction } from "@/app/actions/email";
import { emptyState } from "@/app/actions/shared";
import { Badge, buttonClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton } from "./form-bits";
import { EMAIL_KIND_META, type EmailKind } from "@/lib/constants";
import type { Tone } from "@/lib/constants";

export function DigestSendForm() {
  const [state, formAction] = useActionState(sendDigestAction, emptyState);
  const [justMe, setJustMe] = useState(true);

  return (
    <form action={formAction} className="space-y-3">
      <FormBanner state={state} />
      {justMe ? <input type="hidden" name="justMe" value="1" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          variant={justMe ? "secondary" : "primary"}
          icon="mail"
          pendingLabel="Building digests…"
        >
          {justMe ? "Send one to me" : "Send to everybody"}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setJustMe((current) => !current)}
          className={buttonClass("ghost", "text-xs")}
        >
          {justMe ? "Actually, send to everybody" : "Just send one to me"}
        </button>
      </div>
      {!justMe ? (
        <p className="text-xs text-amber-700">
          This will email every active member who has not opted out.
        </p>
      ) : null}
    </form>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  SENT: "green",
  LOGGED: "slate",
  FAILED: "rose",
};

/** One row of the log, expanding to the exact text of the message. */
export function EmailPreview({
  message,
}: {
  message: {
    id: string;
    to: string;
    subject: string;
    body: string;
    kind: string;
    status: string;
    error: string | null;
    createdAt: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const kindLabel = EMAIL_KIND_META[message.kind as EmailKind]?.label ?? message.kind;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <Icon
          name={open ? "chevron-down" : "chevron-right"}
          className="size-3.5 shrink-0 text-ink-400"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">
            {message.subject}
          </span>
          <span className="block truncate text-xs text-ink-500">
            {message.to} · {message.createdAt}
          </span>
        </span>
        <Badge tone="slate">{kindLabel}</Badge>
        <Badge tone={STATUS_TONE[message.status] ?? "slate"}>
          {message.status === "LOGGED" ? "not sent" : message.status.toLowerCase()}
        </Badge>
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {message.error ? (
            <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{message.error}</p>
          ) : null}
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-700">
            {message.body}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
