"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { updateDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import { Card, Field, buttonClass, inputClass } from "../ui";
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

export function DocumentEditForm({
  document,
  categories,
  productions,
  groupEmail,
}: {
  document: {
    id: string;
    title: string;
    description: string | null;
    categoryId: string;
    productionId: string | null;
    visibility: string;
    pinned: boolean;
    tags: string;
    source: string;
  };
  categories: FormCategory[];
  productions: FormProduction[];
  groupEmail: string | null;
}) {
  const [state, formAction] = useActionState(updateDocumentAction, emptyState);
  const [categoryId, setCategoryId] = useState(document.categoryId);
  const [productionId, setProductionId] = useState(document.productionId ?? "none");
  const [visibility, setVisibility] = useState(document.visibility);

  const category = categories.find((item) => item.id === categoryId);

  function pickCategory(nextId: string) {
    setCategoryId(nextId);
    const next = categories.find((item) => item.id === nextId);
    if (!next) return;
    if (visibility === "COMPANY" && !next.companyVisible) setVisibility("BOARD");
    if (next.scope === "STANDING") setProductionId("none");
    if (next.scope === "PRODUCTION" && productionId === "none") setProductionId("");
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={document.id} />
      <FormBanner state={state} />

      <Card className="space-y-5">
        <Field
          label="Name"
          htmlFor="title"
          required
          hint={
            document.source === "CREATED"
              ? "Renaming here also renames the file in Google Drive, following the hub's naming rule."
              : "This is the name members see on the hub. The file keeps its own name in Drive."
          }
        >
          <input
            id="title"
            name="title"
            defaultValue={document.title}
            className={inputClass}
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
        <VisibilityPicker
          value={visibility}
          onChange={setVisibility}
          groupEmail={groupEmail}
          category={category}
        />
        <DescriptionField defaultValue={document.description ?? undefined} />
        <TagsField defaultValue={document.tags} />
        <Toggle
          name="pinned"
          label="Pin to the top of the dashboard"
          hint="Use sparingly — for the two or three things everyone needs this week."
          defaultChecked={document.pinned}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={`/documents/${document.id}`} className={buttonClass("ghost")}>
          Cancel
        </Link>
        <SubmitButton icon="check" pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
