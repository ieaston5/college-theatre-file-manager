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
  EditAccessPicker,
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
  companyCreatorOnly = false,
}: {
  document: {
    id: string;
    title: string;
    description: string | null;
    categoryId: string;
    productionId: string | null;
    visibility: string;
    editAccess: string;
    pinned: boolean;
    tags: string;
    source: string;
  };
  categories: FormCategory[];
  productions: FormProduction[];
  groupEmail: string | null;
  companyCreatorOnly?: boolean;
}) {
  const [state, formAction] = useActionState(updateDocumentAction, emptyState);
  const [categoryId, setCategoryId] = useState(document.categoryId);
  const [productionId, setProductionId] = useState(document.productionId ?? "none");
  const [visibility, setVisibility] = useState(document.visibility);
  const [editAccess, setEditAccess] = useState(document.editAccess);

  const category = categories.find((item) => item.id === categoryId);

  function pickCategory(nextId: string) {
    setCategoryId(nextId);
    const next = categories.find((item) => item.id === nextId);
    if (!next) return;
    // A company member cannot publish to the board, so private is the only
    // place a board-only category can land for them.
    if (visibility === "COMPANY" && !next.companyVisible) {
      setVisibility(companyCreatorOnly ? "PRIVATE" : "BOARD");
    }
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
          companyCreatorOnly={companyCreatorOnly}
        />
      </Card>

      <Card className="space-y-5">
        <VisibilityPicker
          value={visibility}
          onChange={setVisibility}
          groupEmail={groupEmail}
          category={category}
          companyCreatorOnly={companyCreatorOnly}
        />
        <EditAccessPicker
          value={editAccess}
          onChange={setEditAccess}
          visibility={visibility}
          category={category}
          companyCreatorOnly={companyCreatorOnly}
        />
        <DescriptionField defaultValue={document.description ?? undefined} />
        <TagsField defaultValue={document.tags} />
        {/* Pinning surfaces a document on the board's dashboard, which a
            company member never sees — so it is not offered to them, and the
            existing state is carried through untouched. */}
        {companyCreatorOnly ? (
          document.pinned ? <input type="hidden" name="pinned" value="true" /> : null
        ) : (
          <Toggle
            name="pinned"
            label="Pin to the top of the dashboard"
            hint="Use sparingly — for the two or three things everyone needs this week."
            defaultChecked={document.pinned}
          />
        )}
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
