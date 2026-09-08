"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  saveCategoryAction,
  saveConfigAction,
  saveMemberAction,
  saveProductionAction,
  saveTemplateAction,
} from "@/app/actions/admin";
import { emptyState } from "@/app/actions/shared";
import { CATEGORY_ICON_KEYS, Icon } from "../icons";
import { Card, Field, buttonClass, inputClass, selectClass } from "../ui";
import { FormBanner, RadioCards, SubmitButton, Toggle } from "./form-bits";
import {
  BOARD_ROLES,
  CATEGORY_SCOPES,
  CATEGORY_SCOPE_META,
  CREATABLE_DOC_TYPES,
  DOC_TYPE_META,
  EDIT_ACCESS_LEVELS,
  EDIT_ACCESS_META,
  PRODUCTION_STATUSES,
  PRODUCTION_STATUS_META,
  ROLE_META,
  SHARE_MODES,
  SHARE_MODE_META,
  VISIBILITIES,
  VISIBILITY_META,
} from "@/lib/constants";
import { applyNamingTemplate } from "@/lib/utils";

// --- settings ---------------------------------------------------------------

export function ConfigForm({
  config,
  boardCount,
}: {
  config: {
    orgName: string;
    shareMode: string;
    groupEmail: string | null;
    groupCanEdit: boolean;
    namingTemplate: string;
    driveRootName: string;
    currentSeason: string | null;
    stampDocHeader: boolean;
  };
  boardCount: number;
}) {
  const [state, formAction] = useActionState(saveConfigAction, emptyState);
  const [template, setTemplate] = useState(config.namingTemplate);
  const [shareMode, setShareMode] = useState(config.shareMode);

  const preview = applyNamingTemplate(template, {
    production: "URINETOWN",
    category: "Budgets",
    title: "Running budget",
    season: config.currentSeason ?? "Fall 2026",
  });

  return (
    <form action={formAction} className="space-y-5">
      <FormBanner state={state} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Organisation name" htmlFor="orgName" required>
          <input
            id="orgName"
            name="orgName"
            defaultValue={config.orgName}
            className={inputClass}
            required
          />
        </Field>
        <Field
          label="Current season"
          htmlFor="currentSeason"
          hint="Shown on the dashboard and available as {season} in file names."
        >
          <input
            id="currentSeason"
            name="currentSeason"
            defaultValue={config.currentSeason ?? ""}
            placeholder="Fall 2026"
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="How board documents reach the board in Drive"
        required
        hint={
          shareMode === "MEMBERS"
            ? `Each board document will carry ${boardCount} individual ${
                boardCount === 1 ? "permission" : "permissions"
              }. Changing this makes every existing document need re-sharing — the hub will offer a sweep.`
            : "The hub cannot see who is in a consumer Google Group, so disabling somebody here will not remove their access in Drive."
        }
      >
        <RadioCards
          name="shareMode"
          columns={2}
          value={shareMode}
          onChange={setShareMode}
          options={SHARE_MODES.map((option) => ({
            value: option,
            label: SHARE_MODE_META[option].label,
            description: SHARE_MODE_META[option].blurb,
            icon: SHARE_MODE_META[option].icon,
            tint: SHARE_MODE_META[option].tint,
          }))}
        />
      </Field>

      <Field
        label="Board Google Group"
        htmlFor="groupEmail"
        hint={
          shareMode === "MEMBERS"
            ? "Not used for access while sharing per member, but keep it — it is still how you email everybody, and switching back needs it."
            : "Documents marked “board” are shared with this address in Drive. Leave blank and the hub will list them but not share them."
        }
      >
        <input
          id="groupEmail"
          name="groupEmail"
          type="email"
          defaultValue={config.groupEmail ?? ""}
          placeholder="pennplayers-board@googlegroups.com"
          className={inputClass}
        />
      </Field>

      <Field
        label="File naming rule"
        htmlFor="namingTemplate"
        required
        hint="Tokens: {production} {category} {title} {season} {date}. Empty tokens and their brackets are dropped."
      >
        <input
          id="namingTemplate"
          name="namingTemplate"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
          className={inputClass}
          required
        />
        <p className="mt-1.5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
          Example: <span className="font-medium text-ink-900">{preview}</span>
        </p>
      </Field>

      <Field
        label="Drive folder name"
        htmlFor="driveRootName"
        required
        hint="The top-level folder in the hub account's Drive. Renaming this here does not rename an existing folder."
      >
        <input
          id="driveRootName"
          name="driveRootName"
          defaultValue={config.driveRootName}
          className={inputClass}
          required
        />
      </Field>

      <Toggle
        name="stampDocHeader"
        label="Put a header block at the top of new documents"
        hint="Title, show, category, owner and visibility — so a document found in Drive still explains itself."
        defaultChecked={config.stampDocHeader}
      />

      <div className="flex justify-end">
        <SubmitButton icon="check">Save settings</SubmitButton>
      </div>
    </form>
  );
}

// --- members ----------------------------------------------------------------

export function MemberForm({
  member,
}: {
  member?: { id: string; email: string; name: string | null; position: string | null; role: string };
}) {
  const [state, formAction] = useActionState(saveMemberAction, emptyState);

  return (
    <form action={formAction} className="space-y-4">
      {member ? <input type="hidden" name="id" value={member.id} /> : null}
      <FormBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Google email"
          htmlFor="email"
          required
          hint="The address they sign in with — their board Gmail account."
        >
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={member?.email}
            placeholder="pennplayers.tech@gmail.com"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Name" htmlFor="name">
          <input
            id="name"
            name="name"
            defaultValue={member?.name ?? ""}
            placeholder="Alex Rivera"
            className={inputClass}
          />
        </Field>
        <Field label="Board position" htmlFor="position">
          <input
            id="position"
            name="position"
            defaultValue={member?.position ?? ""}
            placeholder="Technical Director"
            className={inputClass}
          />
        </Field>
        <Field label="Role" htmlFor="role" required>
          <select
            id="role"
            name="role"
            defaultValue={member?.role ?? "BOARD"}
            className={selectClass}
          >
            {BOARD_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_META[role].label} — {ROLE_META[role].blurb}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2">
        {member ? (
          <Link href="/admin/members" className={buttonClass("ghost")}>
            Cancel
          </Link>
        ) : null}
        <SubmitButton icon={member ? "check" : "user-plus"}>
          {member ? "Save member" : "Add member"}
        </SubmitButton>
      </div>
    </form>
  );
}

// --- categories -------------------------------------------------------------

export function CategoryForm({
  category,
}: {
  category?: {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    scope: string;
    defaultDocType: string | null;
    defaultVisibility: string;
    folderName: string | null;
    sortOrder: number;
    companyVisible: boolean;
    keywords: string | null;
    defaultEditAccess: string;
  };
}) {
  const [state, formAction] = useActionState(saveCategoryAction, emptyState);
  const [icon, setIcon] = useState(category?.icon ?? "folder");
  const [color, setColor] = useState(category?.color ?? "#6366f1");
  const [scope, setScope] = useState(category?.scope ?? "BOTH");

  return (
    <form action={formAction} className="space-y-5">
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <FormBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required>
          <input
            id="name"
            name="name"
            defaultValue={category?.name}
            placeholder="Rehearsal reports"
            className={inputClass}
            required
          />
        </Field>
        <Field
          label="Drive subfolder"
          htmlFor="folderName"
          hint="Leave blank to use the name above."
        >
          <input
            id="folderName"
            name="folderName"
            defaultValue={category?.folderName ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="What goes here"
        htmlFor="description"
        hint="Shown on the dashboard tile and in the create form — this is where you teach people what belongs where."
      >
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={category?.description ?? ""}
          className={inputClass}
        />
      </Field>

      <Toggle
        name="companyVisible"
        label="Production companies can see documents here"
        hint="Turn this on for the things a cast or crew legitimately needs — schedules, scripts, contact sheets. Leave it off for budgets, casting and governance: those categories are then never offered as “Company” and never appear to company members."
        defaultChecked={category?.companyVisible ?? false}
      />

      <Field
        label="Words that suggest this category"
        htmlFor="keywords"
        hint="Comma separated. Used when importing an existing pile of Drive files to guess where each one belongs — “budget, receipts, reimbursement, invoice”. Nothing is filed without you confirming it."
      >
        <input
          id="keywords"
          name="keywords"
          defaultValue={category?.keywords ?? ""}
          placeholder="budget, receipts, reimbursement"
          className={inputClass}
        />
      </Field>

      <Field label="Scope" required>
        <RadioCards
          name="scope"
          value={scope}
          onChange={setScope}
          options={CATEGORY_SCOPES.map((scope) => ({
            value: scope,
            label: CATEGORY_SCOPE_META[scope].label,
            description: CATEGORY_SCOPE_META[scope].blurb,
          }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Usual file type" htmlFor="defaultDocType">
          <select
            id="defaultDocType"
            name="defaultDocType"
            defaultValue={category?.defaultDocType ?? ""}
            className={selectClass}
          >
            <option value="">No default</option>
            {CREATABLE_DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOC_TYPE_META[type].label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Default edit level"
          htmlFor="defaultEditAccess"
          required
          hint="Who can change the file, before anyone overrides it per document."
        >
          <select
            id="defaultEditAccess"
            name="defaultEditAccess"
            defaultValue={category?.defaultEditAccess ?? "BOARD"}
            className={selectClass}
          >
            {EDIT_ACCESS_LEVELS.map((level) => (
              <option key={level} value={level}>
                {EDIT_ACCESS_META[level].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default visibility" htmlFor="defaultVisibility" required>
          <select
            id="defaultVisibility"
            name="defaultVisibility"
            defaultValue={category?.defaultVisibility ?? "BOARD"}
            className={selectClass}
          >
            {VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {VISIBILITY_META[visibility].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort order" htmlFor="sortOrder" hint="Lower numbers come first.">
          <input
            id="sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            max={999}
            defaultValue={category?.sortOrder ?? 0}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Colour" htmlFor="color">
          <div className="flex items-center gap-2">
            <input
              id="color"
              name="color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white p-1"
            />
            <span className="text-xs text-ink-500">{color}</span>
          </div>
        </Field>
        <Field label="Icon">
          <input type="hidden" name="icon" value={icon} />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-label={key}
                className={
                  key === icon
                    ? "grid size-8 place-items-center rounded-lg border-2 border-brand-500 bg-brand-50 text-brand-700"
                    : "grid size-8 place-items-center rounded-lg border border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-800"
                }
              >
                <Icon name={key} className="size-4" />
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2">
        {category ? (
          <Link href="/admin/categories" className={buttonClass("ghost")}>
            Cancel
          </Link>
        ) : null}
        <SubmitButton icon="check">{category ? "Save category" : "Add category"}</SubmitButton>
      </div>
    </form>
  );
}

// --- productions ------------------------------------------------------------

export function ProductionForm({
  production,
  currentSeason,
}: {
  production?: {
    id: string;
    name: string;
    abbreviation: string | null;
    season: string | null;
    status: string;
    venue: string | null;
    synopsis: string | null;
    opensOn: string | null;
    closesOn: string | null;
    color: string | null;
  };
  currentSeason: string | null;
}) {
  const [state, formAction] = useActionState(saveProductionAction, emptyState);

  return (
    <form action={formAction} className="space-y-5">
      {production ? <input type="hidden" name="id" value={production.id} /> : null}
      <FormBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Show title" htmlFor="name" required>
          <input
            id="name"
            name="name"
            defaultValue={production?.name}
            placeholder="Urinetown"
            className={inputClass}
            required
          />
        </Field>
        <Field
          label="Short tag"
          htmlFor="abbreviation"
          hint="Used in Drive file names to keep them short, e.g. URINETOWN."
        >
          <input
            id="abbreviation"
            name="abbreviation"
            defaultValue={production?.abbreviation ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Season" htmlFor="season">
          <input
            id="season"
            name="season"
            defaultValue={production?.season ?? currentSeason ?? ""}
            placeholder="Fall 2026"
            className={inputClass}
          />
        </Field>
        <Field label="Venue" htmlFor="venue">
          <input
            id="venue"
            name="venue"
            defaultValue={production?.venue ?? ""}
            placeholder="Iron Gate Theatre"
            className={inputClass}
          />
        </Field>
        <Field label="Opens" htmlFor="opensOn">
          <input
            id="opensOn"
            name="opensOn"
            type="date"
            defaultValue={production?.opensOn ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Closes" htmlFor="closesOn">
          <input
            id="closesOn"
            name="closesOn"
            type="date"
            defaultValue={production?.closesOn ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Status" required>
        <select name="status" defaultValue={production?.status ?? "PLANNING"} className={selectClass}>
          {PRODUCTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PRODUCTION_STATUS_META[status].label} — {PRODUCTION_STATUS_META[status].blurb}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" htmlFor="synopsis" hint="Anything the board should know at a glance.">
        <textarea
          id="synopsis"
          name="synopsis"
          rows={3}
          defaultValue={production?.synopsis ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center justify-end gap-2">
        {production ? (
          <Link href="/admin/productions" className={buttonClass("ghost")}>
            Cancel
          </Link>
        ) : null}
        <SubmitButton icon="check">{production ? "Save show" : "Add show"}</SubmitButton>
      </div>
    </form>
  );
}

// --- templates --------------------------------------------------------------

export function TemplateForm({
  template,
  categories,
}: {
  template?: {
    id: string;
    name: string;
    description: string | null;
    docType: string;
    googleFileId: string;
    categoryId: string | null;
  };
  categories: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(saveTemplateAction, emptyState);

  return (
    <form action={formAction} className="space-y-5">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <FormBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template name" htmlFor="name" required>
          <input
            id="name"
            name="name"
            defaultValue={template?.name}
            placeholder="Rehearsal report"
            className={inputClass}
            required
          />
        </Field>
        <Field label="File type" htmlFor="docType" required>
          <select
            id="docType"
            name="docType"
            defaultValue={template?.docType ?? "DOC"}
            className={selectClass}
          >
            {CREATABLE_DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOC_TYPE_META[type].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Link to the template file"
        htmlFor="link"
        required
        hint="Share the file with the hub's Google account first. Placeholders {{TITLE}}, {{PRODUCTION}}, {{CATEGORY}}, {{OWNER}}, {{DATE}} are filled in on every copy."
      >
        <input
          id="link"
          name="link"
          defaultValue={
            template ? `https://drive.google.com/open?id=${template.googleFileId}` : undefined
          }
          placeholder="https://docs.google.com/document/d/…"
          className={inputClass}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Only offer for" htmlFor="categoryId">
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={template?.categoryId ?? "any"}
            className={selectClass}
          >
            <option value="any">Any category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" htmlFor="description">
          <input
            id="description"
            name="description"
            defaultValue={template?.description ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2">
        {template ? (
          <Link href="/admin/templates" className={buttonClass("ghost")}>
            Cancel
          </Link>
        ) : null}
        <SubmitButton icon="check">{template ? "Save template" : "Add template"}</SubmitButton>
      </div>
    </form>
  );
}

/** Small wrapper so admin pages can drop a titled form card in one line. */
export function FormCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
