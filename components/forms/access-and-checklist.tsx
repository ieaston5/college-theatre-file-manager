"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addChecklistItemAction,
  requestAccessAction,
  runRolloverAction,
} from "@/app/actions/rollover";
import { emptyState } from "@/app/actions/shared";
import { Field, buttonClass, inputClass, selectClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";
import { pluralize, relativeTime } from "@/lib/utils";

/**
 * Asking to be let in.
 *
 * The reply is identical whether the document exists, has been deleted, or was
 * never there — so this cannot be used to find out what the hub is holding.
 */
export function RequestAccessForm({ documentId }: { documentId: string }) {
  const [state, formAction] = useActionState(requestAccessAction, emptyState);

  if (state.ok) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <Icon name="check-circle" className="mt-0.5 size-4 shrink-0" />
        <span>{state.ok}</span>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 text-left">
      <input type="hidden" name="documentId" value={documentId} />
      <FormBanner state={state} />
      <Field
        label="Ask for access"
        htmlFor="message"
        hint="Optional note. Whoever looks after it decides — the hub will not tell you anything about the document either way."
      >
        <input
          id="message"
          name="message"
          className={inputClass}
          placeholder="Sam sent me this link for the load-in"
        />
      </Field>
      <SubmitButton icon="mail" pendingLabel="Sending…">
        Send the request
      </SubmitButton>
    </form>
  );
}

/** Add a one-off item to a show's checklist. */
export function AddChecklistItemForm({
  productionId,
  categories,
}: {
  productionId: string;
  categories: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(addChecklistItemAction, emptyState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "text-xs")}>
        <Icon name="plus" className="size-3.5" />
        Add an item
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 border-t border-ink-100 pt-3">
      <input type="hidden" name="productionId" value={productionId} />
      <FormBanner state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-600">What needs doing</span>
          <input
            name="label"
            className={inputClass}
            placeholder="Get the tech rider signed"
            required
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-600">Ticks itself when</span>
          <select name="categoryId" className={selectClass} defaultValue="none">
            <option value="none">Never — tick it by hand</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                Something is filed in {category.name}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="secondary" icon="plus" pendingLabel="Adding…">
          Add
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export type RolloverShow = { id: string; name: string; season: string | null; status: string };
export type RolloverMember = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  lastLoginAt: string | null;
  privateCount: number;
  ownedInDriveCount: number;
};

/**
 * The turnover wizard. Everything is opt-in per show and per person, because
 * "archive the season" is the one action here that is annoying to undo.
 */
export function RolloverForm({
  currentSeason,
  shows,
  members,
  companyToRetire,
}: {
  currentSeason: string | null;
  shows: RolloverShow[];
  members: RolloverMember[];
  companyToRetire: number;
}) {
  const [state, formAction] = useActionState(runRolloverAction, emptyState);
  const [pickedShows, setPickedShows] = useState<string[]>(shows.map((show) => show.id));
  const [pickedMembers, setPickedMembers] = useState<string[]>([]);

  const handover = members.filter(
    (member) => pickedMembers.includes(member.id) && member.privateCount > 0,
  );

  function toggle(list: string[], set: (value: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  if (state.ok) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <Icon name="check-circle" className="mt-0.5 size-4 shrink-0" />
          <span className="font-medium">{state.ok}</span>
        </div>
        {state.warnings && state.warnings.length > 0 ? (
          <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <Link href="/admin/sharing" className={buttonClass("secondary")}>
          <Icon name="shield" className="size-4" />
          Check sharing in Drive
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <FormBanner state={state} />

      <Field
        label="New season"
        htmlFor="newSeason"
        hint="Shown on the dashboard and available as {season} in file names. Leave blank to keep the current one."
      >
        <input
          id="newSeason"
          name="newSeason"
          className={inputClass}
          placeholder={currentSeason ? `after ${currentSeason}` : "Fall 2027"}
        />
      </Field>

      {shows.length > 0 ? (
        <Field
          label={`Shows to archive (${pickedShows.length} of ${shows.length})`}
          hint="Archiving hides a show from the dashboard and ends its company's access — in the hub and in Drive. The documents stay exactly where they are."
        >
          <ul className="space-y-1.5">
            {shows.map((show) => (
              <li key={show.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 bg-white p-2.5">
                  <input
                    type="checkbox"
                    name="showIds"
                    value={show.id}
                    checked={pickedShows.includes(show.id)}
                    onChange={() => toggle(pickedShows, setPickedShows, show.id)}
                    className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{show.name}</span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {show.season ?? "no season"} · {show.status.toLowerCase()}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Field>
      ) : (
        <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
          No shows look finished, so there is nothing to archive.
        </p>
      )}

      {members.length > 0 ? (
        <Field
          label={`Board members to disable (${pickedMembers.length} of ${members.length})`}
          hint="Suggested because they have not signed in for months. Disabling keeps everything they filed and blocks their sign-in — nothing is deleted."
        >
          <ul className="space-y-1.5">
            {members.map((member) => (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 bg-white p-2.5">
                  <input
                    type="checkbox"
                    name="memberIds"
                    value={member.id}
                    checked={pickedMembers.includes(member.id)}
                    onChange={() => toggle(pickedMembers, setPickedMembers, member.id)}
                    className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-900">
                      {member.name ?? member.email}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {member.email} · last in{" "}
                      {member.lastLoginAt ? relativeTime(member.lastLoginAt) : "never"}
                      {member.ownedInDriveCount > 0
                        ? ` · owns ${member.ownedInDriveCount} ${pluralize(
                            member.ownedInDriveCount,
                            "file",
                          )} in Drive`
                        : ""}
                    </span>
                  </span>
                  {member.privateCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      {member.privateCount} private
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      {handover.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Ask these people before you disable them</p>
          <p className="mt-1 text-xs leading-relaxed">
            Private documents belong to the person who filed them. The hub cannot read them, hand
            them over or reassign them — not even for an admin. Anything the club needs next year
            has to be moved out of private before the account goes quiet.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {handover.map((member) => (
              <li key={member.id}>
                <span className="font-medium">{member.name ?? member.email}</span> —{" "}
                {member.privateCount} private {pluralize(member.privateCount, "document")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Toggle
        name="moveFolders"
        label="Move archived shows' Drive folders into an Archive folder"
        hint="Tidies the hub's Drive without touching the files themselves."
        defaultChecked
      />

      {companyToRetire > 0 ? (
        <p className="text-xs text-ink-500">
          {companyToRetire} company {pluralize(companyToRetire, "membership")} on the selected shows
          will stop granting access.
        </p>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton icon="refresh" pendingLabel="Rolling over…">
          Roll the season over
        </SubmitButton>
      </div>
    </form>
  );
}
