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
import { Avatar, Badge, Card, Field, buttonClass, inputClass, selectClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export type RoleOption = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
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
  const [roleId, setRoleId] = useState(roles.find((role) => role.isDefault)?.id ?? roles[0]?.id ?? "");

  const parsed = useMemo(() => parsePeopleInput(text), [text]);
  const role = roles.find((item) => item.id === roleId);

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

      <Field
        label="What are they doing on the show?"
        htmlFor="roleId"
        required
        hint={
          role
            ? `${role.name} can see: ${role.categoryNames.join(", ") || "nothing yet — add categories to this role"}.`
            : "The role decides which categories they can see."
        }
      >
        <select
          id="roleId"
          name="roleId"
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          className={selectClass}
          required
        >
          {roles.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          Nothing is emailed. They sign in with Google and see only what this role allows.
        </p>
        <SubmitButton icon="user-plus" pendingLabel="Adding…">
          {parsed.length > 1 ? `Add ${parsed.length} people` : "Add to the company"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** One row of the company list, editable in place. */
export function MembershipRow({
  membership,
  roles,
  onRemove,
}: {
  membership: {
    id: string;
    title: string | null;
    roleId: string | null;
    userName: string | null;
    userEmail: string;
    userStatus: string;
    lastLoginAt: string | null;
  };
  roles: RoleOption[];
  onRemove: React.ReactNode;
}) {
  const [state, formAction] = useActionState(updateMembershipAction, emptyState);
  const [editing, setEditing] = useState(false);

  const role = roles.find((item) => item.id === membership.roleId);

  if (!editing) {
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
        <Badge tone={role ? "green" : "rose"}>{role?.name ?? "No role"}</Badge>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={buttonClass("ghost", "px-2")}
          aria-label={`Edit ${membership.userEmail}`}
        >
          <Icon name="pencil" className="size-4" />
        </button>
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
          <div className="min-w-40 flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-600">
              {membership.userName ?? membership.userEmail}
            </span>
            <input
              name="title"
              defaultValue={membership.title ?? ""}
              placeholder="Part or job, e.g. Ensemble"
              className={inputClass}
            />
          </div>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-600">Role</span>
            <select name="roleId" defaultValue={membership.roleId ?? ""} className={selectClass}>
              {roles.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
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
