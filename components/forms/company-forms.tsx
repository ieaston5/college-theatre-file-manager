"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  addCompanyMembersAction,
  saveProductionRoleAction,
  updateMembershipAction,
} from "@/app/actions/company";
import { emptyState } from "@/app/actions/shared";
import { parsePeopleInput } from "@/lib/utils";
import { Avatar, Badge, Card, Field, buttonClass, inputClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export type RoleOption = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  canCreate: boolean;
  categoryNames: string[];
};

/**
 * Paste a cast list, pick what they are doing, done.
 *
 * The friction this removes is the whole point of the feature: a company of
 * twenty-five exists as a column in a contact sheet, and adding them should
 * cost one paste rather than twenty-five forms.
 */
export function AddCompanyMembersForm({
  productionId,
  productionName,
  roles,
}: {
  productionId: string;
  productionName: string;
  roles: RoleOption[];
}) {
  const [state, formAction] = useActionState(addCompanyMembersAction, emptyState);
  const [text, setText] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([roles.find((role) => role.isDefault)?.id ?? roles[0]?.id].filter((id): id is string => Boolean(id)));

  const parsed = useMemo(() => parsePeopleInput(text), [text]);
  const categoryNames = [...new Set(roles.filter((role) => roleIds.includes(role.id)).flatMap((role) => role.categoryNames))];

  if (roles.length === 0) {
    return (
      <Card className="text-sm text-ink-600">
        There are no production roles set up yet, so there is nothing to add people as. An admin can
        create them in{" "}
        <Link href="/admin/roles" className="font-medium text-brand-700 hover:underline">
          Admin → Production roles
        </Link>
        .
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productionId" value={productionId} />
      <FormBanner state={state} />

      <Field
        label={`Who is joining ${productionName}?`}
        htmlFor="people"
        required
        hint="One per line, or paste a column straight out of a contact sheet. “Nadia Brooks nadia@example.com Hope Cladwell” works too — the hub picks out the name, the email and the part."
      >
        <textarea
          id="people"
          name="people"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"nadia.brooks@gmail.com\nTheo Marchetti <theo@gmail.com>\nInes Duarte\tines@gmail.com\tEnsemble"}
          className={`${inputClass} font-mono text-xs`}
          required
        />
      </Field>

      {parsed.length > 0 ? (
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
            {parsed.length} {parsed.length === 1 ? "person" : "people"} recognised
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {parsed.slice(0, 40).map((person) => (
              <li
                key={person.email}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700"
                title={person.email}
              >
                <Icon name="mail" className="size-3" />
                {person.name ?? person.email}
                {person.title ? <span className="text-ink-500">· {person.title}</span> : null}
              </li>
            ))}
            {parsed.length > 40 ? (
              <li className="text-xs text-ink-500">and {parsed.length - 40} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Roles on this show</legend>
        <p className="text-xs text-ink-500">Select every role that applies. Existing members keep their other roles.</p>
        <div className="flex flex-wrap gap-3">
          {roles.map((role) => <label key={role.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="roleIds" value={role.id} checked={roleIds.includes(role.id)}
              onChange={(event) => setRoleIds((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} />
            {role.name}
          </label>)}
        </div>
        <p className="text-xs text-ink-500">Selected roles can see: {categoryNames.join(", ") || "no categories selected"}.</p>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          New members receive an invitation. They sign in with Google and see the categories their roles allow.
        </p>
        <SubmitButton icon="user-plus" pendingLabel="Adding…">
          {parsed.length > 1 ? `Add ${parsed.length} people` : "Add to the company"}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * One row of the company list, editable in place by whoever runs the show.
 *
 * Everyone on a production can see who else is on it, but only the people who
 * may actually change a membership get the pencil: offering it to a cast
 * member and then refusing the save is worse than not offering it at all.
 */
export function MembershipRow({
  membership,
  roles,
  canEdit,
  onRemove,
}: {
  membership: {
    id: string;
    title: string | null;
    roleIds: string[];
    userName: string | null;
    userEmail: string;
    userStatus: string;
    lastLoginAt: string | null;
  };
  roles: RoleOption[];
  /** Whether this viewer may change the person's part or role. */
  canEdit: boolean;
  onRemove: React.ReactNode;
}) {
  const [state, formAction] = useActionState(updateMembershipAction, emptyState);
  const [editing, setEditing] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState(membership.roleIds);
  const [title, setTitle] = useState(membership.title ?? "");
  const [name, setName] = useState(membership.userName ?? "");

  const assignedRoles = roles.filter((role) => membership.roleIds.includes(role.id));

  if (!editing || !canEdit) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <Avatar name={membership.userName} email={membership.userEmail} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink-900">
              {membership.userName ?? membership.userEmail}
            </span>
            {membership.title ? (
              <span className="truncate text-xs text-ink-500">{membership.title}</span>
            ) : null}
            {membership.userStatus === "INVITED" ? (
              <Badge tone="amber">Not signed in yet</Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-ink-500">{membership.userEmail}</div>
        </div>
        <div className="flex flex-wrap gap-1">{assignedRoles.length ? assignedRoles.map((role) => <Badge key={role.id} tone="green">{role.name}</Badge>) : <Badge tone="rose">No active role</Badge>}</div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setSelectedRoleIds(membership.roleIds);
              setTitle(membership.title ?? "");
              setName(membership.userName ?? "");
              setEditing(true);
            }}
            className={buttonClass("ghost", "px-2")}
            aria-label={`Edit ${membership.userEmail}`}
          >
            <Icon name="pencil" className="size-4" />
          </button>
        ) : null}
        {onRemove}
      </li>
    );
  }

  return (
    <li className="px-4 py-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={membership.id} />
        <FormBanner state={state} />
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name" htmlFor={`member-name-${membership.id}`} className="min-w-40 flex-1"
            hint="Used throughout the hub.">
            <input id={`member-name-${membership.id}`} name="name" value={name}
              onChange={(event) => setName(event.target.value)} maxLength={120} className={inputClass} />
          </Field>
          <div className="min-w-40 flex-1">
            <label htmlFor={`member-title-${membership.id}`} className="mb-1 block text-xs font-medium text-ink-600">
              Part or position
            </label>
            <input
              id={`member-title-${membership.id}`}
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Part or job, e.g. Ensemble"
              className={inputClass}
            />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-ink-600">Roles</legend>
            {roles.map((role) => <label key={role.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="roleIds" value={role.id} checked={selectedRoleIds.includes(role.id)}
                onChange={(event) => setSelectedRoleIds((selected) => event.target.checked
                  ? [...selected, role.id] : selected.filter((id) => id !== role.id))} />
              {role.name}
            </label>)}
            <p className="text-xs text-ink-500">Uncheck a role to remove its access.</p>
          </fieldset>
          <SubmitButton variant="secondary" icon="check" pendingLabel="Saving…">
            Save
          </SubmitButton>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className={buttonClass("ghost")}
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

/** Admin: what each production role can see. */
export function ProductionRoleForm({
  role,
  categories,
}: {
  role?: {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
    isDefault: boolean;
    canCreate: boolean;
    categoryIds: string[];
  };
  categories: Array<{ id: string; name: string; icon: string; color: string }>;
}) {
  const [state, formAction] = useActionState(saveProductionRoleAction, emptyState);
  const [selected, setSelected] = useState<string[]>(role?.categoryIds ?? []);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <FormBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Role name" htmlFor="name" required className="sm:col-span-2">
          <input
            id="name"
            name="name"
            defaultValue={role?.name}
            placeholder="Cast"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Order" htmlFor="sortOrder" hint="Lower comes first.">
          <input
            id="sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            max={999}
            defaultValue={role?.sortOrder ?? 0}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="description">
        <input
          id="description"
          name="description"
          defaultValue={role?.description ?? ""}
          placeholder="Performers. Schedule, script, contact sheet."
          className={inputClass}
        />
      </Field>

      <Field
        label="What this role can see"
        hint="Only categories an admin has opened up to companies appear here. Everything else stays board-only."
      >
        {categories.length === 0 ? (
          <p className="text-sm text-ink-500">
            No categories are open to companies yet. Turn that on for a category in Admin →
            Categories first.
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {categories.map((category) => {
              const on = selected.includes(category.id);
              return (
                <label
                  key={category.id}
                  className={
                    on
                      ? "flex cursor-pointer items-center gap-2 rounded-lg border border-brand-400 bg-brand-50/60 px-3 py-2"
                      : "flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 hover:border-ink-300"
                  }
                >
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    checked={on}
                    onChange={() => toggle(category.id)}
                    className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                  />
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded"
                    style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                  >
                    <Icon name={category.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </Field>

      <Toggle
        name="canCreate"
        label="This role can add documents to the hub"
        hint="Off for cast — they read what is shared with them. Worth turning on for stage management, who file a rehearsal report every night and should not need a board account. Even when on, they can only file into this role's categories, on shows they are working on, and never for the board."
        defaultChecked={role?.canCreate ?? false}
      />

      <Toggle
        name="isDefault"
        label="Pre-select this role when adding people"
        hint="Usually Cast — it is the one you add most of."
        defaultChecked={role?.isDefault ?? false}
      />

      <div className="flex items-center justify-end gap-2">
        {role ? (
          <Link href="/admin/roles" className={buttonClass("ghost")}>
            Cancel
          </Link>
        ) : null}
        <SubmitButton icon="check">{role ? "Save role" : "Add role"}</SubmitButton>
      </div>
    </form>
  );
}

/** Copies a ready-to-send message, since the hub does not email yet. */
export function CopyInviteButton({
  emails,
  appUrl,
  productionName,
}: {
  emails: string[];
  appUrl: string;
  productionName: string;
}) {
  const [copied, setCopied] = useState<"none" | "text" | "emails">("none");

  const message = `You've been added to the Penn Players hub for ${productionName}.

Sign in with Google at ${appUrl} using this email address, and you'll find the schedule, contact sheet and anything else you need for the show. Nothing else is visible to you, so you can't lose anything.`;

  async function copy(what: "text" | "emails") {
    try {
      await navigator.clipboard.writeText(what === "text" ? message : emails.join(", "));
      setCopied(what);
      setTimeout(() => setCopied("none"), 2500);
    } catch {
      setCopied("none");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => copy("text")} className={buttonClass("secondary")}>
        <Icon name={copied === "text" ? "check" : "copy"} className="size-4" />
        {copied === "text" ? "Copied" : "Copy invite message"}
      </button>
      <button
        type="button"
        onClick={() => copy("emails")}
        disabled={emails.length === 0}
        className={buttonClass("secondary")}
      >
        <Icon name={copied === "emails" ? "check" : "mail"} className="size-4" />
        {copied === "emails" ? "Copied" : `Copy ${emails.length} addresses`}
      </button>
    </div>
  );
}
