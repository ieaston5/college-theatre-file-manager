"use client";

import {
  CATEGORY_SCOPE_META,
  EDIT_ACCESS_META,
  VISIBILITIES,
  VISIBILITY_META,
  allowedEditAccess,
  type CategoryScope,
} from "@/lib/constants";
import { Field, inputClass, selectClass } from "../ui";
import { RadioCards } from "./form-bits";
import { Icon } from "../icons";

export type FormCategory = {
  id: string;
  name: string;
  scope: string;
  defaultDocType: string | null;
  defaultVisibility: string;
  color: string;
  icon: string;
  description: string | null;
  /** Whether this category may be shared with a production's company. */
  companyVisible: boolean;
  defaultEditAccess: string;
};

export type FormProduction = {
  id: string;
  name: string;
  season: string | null;
  status: string;
  abbreviation: string | null;
};

export type FormTemplate = {
  id: string;
  name: string;
  docType: string;
  categoryId: string | null;
  description: string | null;
};

export function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: FormCategory[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = categories.find((category) => category.id === value);
  return (
    <Field
      label="What kind of information is this?"
      htmlFor="categoryId"
      required
      hint={
        selected ? (
          <span className="flex items-start gap-1.5">
            <Icon name={selected.icon} className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {selected.description ?? CATEGORY_SCOPE_META[selected.scope as CategoryScope]?.blurb}
            </span>
          </span>
        ) : (
          "This decides where the file lands in Drive and where it shows up on the dashboard."
        )
      }
    >
      <select
        id="categoryId"
        name="categoryId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
        required
      >
        <option value="">Choose a category…</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ProductionSelect({
  productions,
  value,
  onChange,
  scope,
  companyCreatorOnly,
}: {
  productions: FormProduction[];
  value: string;
  onChange: (value: string) => void;
  scope: string | undefined;
  /** A company member filing for their own show. */
  companyCreatorOnly?: boolean;
}) {
  const standing = scope === "STANDING";
  const required = scope === "PRODUCTION";

  return (
    <Field
      label="Which production?"
      htmlFor="productionId"
      required={required}
      hint={
        standing
          ? "This category is organisation-wide, so it is not attached to a show."
          : required
            ? "Documents in this category always belong to a show."
            : companyCreatorOnly
              ? "Leave as “Not tied to a show” only if it is not about one production in particular."
              : "Leave as “Not tied to a show” for things like board minutes or the constitution."
      }
    >
      <select
        id="productionId"
        name="productionId"
        value={standing ? "none" : value}
        onChange={(event) => onChange(event.target.value)}
        disabled={standing}
        required={required}
        className={selectClass}
      >
        {!required ? <option value="none">Not tied to a show</option> : null}
        {required && !value ? <option value="">Choose a production…</option> : null}
        {productions.map((production) => (
          <option key={production.id} value={production.id}>
            {production.name}
            {production.season ? ` · ${production.season}` : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

const VISIBILITY_TINT: Record<string, string> = {
  PRIVATE: "#d97706",
  COMPANY: "#16a34a",
  BOARD: "#5b3de0",
};

export function VisibilityPicker({
  value,
  onChange,
  groupEmail,
  category,
  companyCount,
  companyCreatorOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  groupEmail: string | null;
  /** Company is only offered where the category allows it. */
  category?: FormCategory;
  /** How many people would get access if Company is chosen. */
  companyCount?: number | null;
  /** A company member filing for their show cannot publish to the board. */
  companyCreatorOnly?: boolean;
}) {
  const options = VISIBILITIES.filter(
    (visibility) =>
      (visibility !== "COMPANY" || category?.companyVisible) &&
      (visibility !== "BOARD" || !companyCreatorOnly),
  );

  return (
    <Field
      label="Who should see it?"
      required
      hint={
        /* A company member never files for the board, so the board's Drive
           group and the board-only categories are not their problem. */
        companyCreatorOnly ? (
          !category ? (
            "Pick a category above and this will say who “Company” reaches."
          ) : category.companyVisible ? (
            "“Company” reaches the people on this show whose role covers this category — plus the board, who can see everything. “Private” keeps it to you until you say otherwise."
          ) : (
            "Only you can see this one. Whoever runs the show can open the category up to the company if it should be shared."
          )
        ) : (
          <>
            {groupEmail
              ? `Board documents are shared with ${groupEmail} in Google Drive. Nobody outside that group gets access.`
              : "No board Google Group is set yet, so board documents will show on the hub but will not be shared in Drive until an admin adds one."}
            {category && !category.companyVisible ? (
              <>
                {" "}
                {category.name} is board-only, so it is never offered to a production company. An
                admin can change that per category.
              </>
            ) : null}
          </>
        )
      }
    >
      <RadioCards
        name="visibility"
        columns={options.length > 2 ? 3 : 2}
        value={value}
        onChange={onChange}
        options={options.map((visibility) => ({
          value: visibility,
          label: VISIBILITY_META[visibility].label,
          description:
            visibility === "PRIVATE" && companyCreatorOnly
              ? "Only you, and anyone you add by hand. Nobody else on the show sees it listed."
              : visibility === "COMPANY" && typeof companyCount === "number"
                ? `${VISIBILITY_META[visibility].blurb} About ${companyCount} ${
                    companyCount === 1 ? "person" : "people"
                  } right now.`
                : VISIBILITY_META[visibility].blurb,
          icon: VISIBILITY_META[visibility].icon,
          tint: VISIBILITY_TINT[visibility],
        }))}
      />
    </Field>
  );
}

/**
 * The second, narrower ladder: everyone who can see it reads it, this says who
 * can change the file. Options are capped by the visibility chosen, and it is
 * pre-filled from the category, so it is normally a no-op.
 */
export function EditAccessPicker({
  value,
  onChange,
  visibility,
  category,
  companyCreatorOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  visibility: string;
  category?: FormCategory;
  /** A company member filing for their own show. */
  companyCreatorOnly?: boolean;
}) {
  const options = allowedEditAccess(visibility);

  if (options.length === 1) {
    return (
      <Field label="Who can change it?">
        <p className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
          {visibility === "PRIVATE"
            ? "Private documents are only editable by you and anyone you add by hand."
            : EDIT_ACCESS_META[options[0]].blurb}
        </p>
      </Field>
    );
  }

  return (
    <Field
      label="Who can change it?"
      required
      hint={`Everyone above can read it — this is only about editing the file itself. Renaming, recategorising and changing who sees it always stays with you${
        category ? ` (${category.name} starts at “${EDIT_ACCESS_META[
          (category.defaultEditAccess as "BOARD") ?? "BOARD"
        ]?.label ?? "the board"}”)` : ""
      }.`}
    >
      <RadioCards
        name="editAccess"
        columns={options.length > 2 ? 3 : 2}
        value={options.includes(value as "BOARD") ? value : options[0]}
        onChange={onChange}
        options={options.map((option) => ({
          value: option,
          label: EDIT_ACCESS_META[option].label,
          description:
            option === "BOARD" && companyCreatorOnly
              ? "You and the board can change the file. Everyone else it is shared with only reads it."
              : EDIT_ACCESS_META[option].blurb,
          icon: EDIT_ACCESS_META[option].icon,
          tint: EDIT_ACCESS_META[option].tint,
        }))}
      />
    </Field>
  );
}

export function TagsField({ defaultValue }: { defaultValue?: string }) {
  return (
    <Field
      label="Tags"
      htmlFor="tags"
      hint="Optional, comma separated. Tags are searchable — e.g. “weekly, load-in, sponsors”."
    >
      <input
        id="tags"
        name="tags"
        defaultValue={defaultValue}
        placeholder="weekly, load-in"
        className={inputClass}
      />
    </Field>
  );
}

export function DescriptionField({ defaultValue }: { defaultValue?: string }) {
  return (
    <Field
      label="What is it for?"
      htmlFor="description"
      hint="One or two lines so the next production manager knows what this is without opening it."
    >
      <textarea
        id="description"
        name="description"
        rows={3}
        defaultValue={defaultValue}
        placeholder="Running budget for the show — update after every purchase."
        className={inputClass}
      />
    </Field>
  );
}
