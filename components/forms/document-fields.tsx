"use client";

import { CATEGORY_SCOPE_META, VISIBILITIES, VISIBILITY_META, type CategoryScope } from "@/lib/constants";
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
}: {
  productions: FormProduction[];
  value: string;
  onChange: (value: string) => void;
  scope: string | undefined;
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

export function VisibilityPicker({
  value,
  onChange,
  groupEmail,
}: {
  value: string;
  onChange: (value: string) => void;
  groupEmail: string | null;
}) {
  return (
    <Field
      label="Who should see it?"
      required
      hint={
        groupEmail
          ? `Board documents are shared with ${groupEmail} in Google Drive. Nobody outside that group gets access.`
          : "No board Google Group is set yet, so board documents will show on the hub but will not be shared in Drive until an admin adds one."
      }
    >
      <RadioCards
        name="visibility"
        columns={2}
        value={value}
        onChange={onChange}
        options={VISIBILITIES.map((visibility) => ({
          value: visibility,
          label: VISIBILITY_META[visibility].label,
          description: VISIBILITY_META[visibility].blurb,
          icon: VISIBILITY_META[visibility].icon,
          tint: visibility === "PRIVATE" ? "#d97706" : "#5b3de0",
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
