"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import { Card, Field, buttonClass, inputClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";
import {
  CategorySelect,
  DescriptionField,
  ProductionSelect,
  TagsField,
  VisibilityPicker,
  type FormCategory,
  type FormProduction,
} from "./document-fields";

export function DocumentRegisterForm({
  categories,
  productions,
  groupEmail,
  hubAccountEmail,
  driveMode,
}: {
  categories: FormCategory[];
  productions: FormProduction[];
  groupEmail: string | null;
  hubAccountEmail: string | null;
  driveMode: "google" | "mock";
}) {
  const [state, formAction] = useActionState(registerDocumentAction, emptyState);
  const [categoryId, setCategoryId] = useState("");
  const [productionId, setProductionId] = useState("none");
  const [visibility, setVisibility] = useState("BOARD");
  const [externalOnly, setExternalOnly] = useState(false);

  const category = categories.find((item) => item.id === categoryId);

  function pickCategory(nextId: string) {
    setCategoryId(nextId);
    const next = categories.find((item) => item.id === nextId);
    if (!next) return;
    setVisibility(next.defaultVisibility);
    if (next.scope === "STANDING") setProductionId("none");
    if (next.scope === "PRODUCTION" && productionId === "none") setProductionId("");
  }

  if (state.documentId && !state.error) {
    return (
      <Card className="text-center">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <Icon name="check-circle" className="size-5" />
        </span>
        <h2 className="text-base font-semibold">{state.ok}</h2>
        <p className="mt-1 text-sm text-ink-500">
          It is now findable on the dashboard under {category?.name ?? "its category"}.
        </p>
        {state.warnings && state.warnings.length > 0 ? (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
            <ul className="space-y-1">
              {state.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={`/documents/${state.documentId}`} className={buttonClass("primary")}>
            View on the hub
          </Link>
          <a href="/documents/register" className={buttonClass("ghost")}>
            Add another
          </a>
        </div>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <FormBanner state={state} />

      <Card className="space-y-5">
        <Field
          label="Link"
          htmlFor="link"
          required
          hint={
            driveMode === "mock"
              ? "Any link works while the hub is running on a simulated Drive."
              : hubAccountEmail
                ? `For Google files, share the file with ${hubAccountEmail} first so the hub can read and re-share it.`
                : "Google Drive is not connected yet, so files will be saved as plain links."
          }
        >
          <input
            id="link"
            name="link"
            className={inputClass}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            required
          />
        </Field>

        <Field
          label="Name on the hub"
          htmlFor="title"
          required
          hint="This is what members see in lists — it does not rename the file in Drive."
        >
          <input
            id="title"
            name="title"
            className={inputClass}
            placeholder="2025–26 season budget"
            required
          />
        </Field>

        <CategorySelect categories={categories} value={categoryId} onChange={pickCategory} />

        <ProductionSelect
          productions={productions}
          value={productionId}
          onChange={setProductionId}
          scope={category?.scope}
        />
      </Card>

      <Card className="space-y-5">
        <VisibilityPicker value={visibility} onChange={setVisibility} groupEmail={groupEmail} />
        <DescriptionField />
        <TagsField />

        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            name="organize"
            label="Move it into the hub's Drive folders"
            hint="Tidies the file into Productions / … / Category. Needs the hub's account to have edit access."
          />
          <Toggle
            name="externalOnly"
            label="Just save the link"
            hint="For things that are not Google files — a website, a Signup Genius, a Dropbox folder."
            checked={externalOnly}
            onChange={setExternalOnly}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/documents" className={buttonClass("ghost")}>
          Cancel
        </Link>
        <SubmitButton icon="link" pendingLabel="Checking the link…">
          Add to the hub
        </SubmitButton>
      </div>
    </form>
  );
}
