"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { updateDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import { applyNamingTemplate } from "@/lib/utils";
import { Card, Field, buttonClass, inputClass } from "../ui";
import { Icon } from "../icons";
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
  namingTemplate,
  currentSeason,
  companyCreatorOnly = false,
}: {
  document: {
    id: string;
    /** What the document is called before the hub's naming rule is applied. */
    baseTitle: string;
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
  namingTemplate: string;
  currentSeason: string | null;
  companyCreatorOnly?: boolean;
}) {
  const [state, formAction] = useActionState(updateDocumentAction, emptyState);
  const [title, setTitle] = useState(document.baseTitle);
  const [categoryId, setCategoryId] = useState(document.categoryId);
  const [productionId, setProductionId] = useState(document.productionId ?? "none");
  const [visibility, setVisibility] = useState(document.visibility);
  const [editAccess, setEditAccess] = useState(document.editAccess);

  const category = categories.find((item) => item.id === categoryId);
  const production = productions.find((item) => item.id === productionId);

  // What the document will be called once the hub's rule is applied —
  // recomposed as the category or the show changes, because it is composed
  // from exactly these.
  const composed = applyNamingTemplate(namingTemplate, {
    production: production?.abbreviation || production?.name || null,
    category: category?.name,
    title: title.trim() || "Untitled",
    season: production?.season ?? currentSeason,
  });

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
              ? "The show, the shelf and the season are added by the hub's naming rule — the file in Drive is renamed to match."
              : "The show, the shelf and the season are added by the hub's naming rule. The file keeps its own name in Drive."
          }
        >
          <input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            required
          />
          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500">
            <Icon name="file" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              Listed as <span className="font-medium text-ink-700">{composed}</span>
            </span>
          </span>
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
