"use client";

import { useActionState } from "react";
import { shareDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import { selectClass } from "../ui";
import { FormBanner, SubmitButton } from "./form-bits";

export function ShareForm({
  documentId,
  members,
}: {
  documentId: string;
  members: Array<{ id: string; name: string | null; email: string }>;
}) {
  const [state, formAction] = useActionState(shareDocumentAction, emptyState);

  if (members.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        Everyone on the hub already has access to this document.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />
      <FormBanner state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-600">Add someone</span>
          <select name="userId" className={selectClass} required defaultValue="">
            <option value="" disabled>
              Choose a member…
            </option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? member.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-600">Access</span>
          <select name="accessLevel" className={selectClass} defaultValue="READER">
            <option value="READER">Can view</option>
            <option value="WRITER">Can edit</option>
          </select>
        </label>
        <SubmitButton variant="secondary" icon="user-plus" pendingLabel="Sharing…">
          Share
        </SubmitButton>
      </div>
    </form>
  );
}
