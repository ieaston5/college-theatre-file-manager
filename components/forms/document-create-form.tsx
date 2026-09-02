"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import { CREATABLE_DOC_TYPES, DOC_TYPE_META } from "@/lib/constants";
import { applyNamingTemplate } from "@/lib/utils";
import { Card, Field, buttonClass, inputClass, selectClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, RadioCards, SubmitButton } from "./form-bits";
import {
  CategorySelect,
  DescriptionField,
  ProductionSelect,
  TagsField,
  VisibilityPicker,
  type FormCategory,
  type FormProduction,
  type FormTemplate,
} from "./document-fields";

export function DocumentCreateForm({
  categories,
  productions,
  templates,
  namingTemplate,
  currentSeason,
  groupEmail,
  driveMode,
  defaultCategoryId,
  defaultProductionId,
}: {
  categories: FormCategory[];
  productions: FormProduction[];
  templates: FormTemplate[];
  namingTemplate: string;
  currentSeason: string | null;
  groupEmail: string | null;
  driveMode: "google" | "mock";
  defaultCategoryId?: string;
  defaultProductionId?: string;
}) {
  const [state, formAction] = useActionState(createDocumentAction, emptyState);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [productionId, setProductionId] = useState(defaultProductionId ?? "none");
  const [docType, setDocType] = useState<string>("DOC");
  const [visibility, setVisibility] = useState<string>("BOARD");
  const [templateId, setTemplateId] = useState("blank");

  const category = categories.find((item) => item.id === categoryId);
  const production = productions.find((item) => item.id === productionId);

  const availableTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.docType === docType &&
          (!template.categoryId || template.categoryId === categoryId),
      ),
    [templates, docType, categoryId],
  );

  const previewName = applyNamingTemplate(namingTemplate, {
    production: production?.abbreviation || production?.name || null,
    category: category?.name,
    title: title.trim() || "Untitled",
    season: production?.season ?? currentSeason,
  });

  function pickCategory(nextId: string) {
    setCategoryId(nextId);
    const next = categories.find((item) => item.id === nextId);
    if (!next) return;
    if (next.defaultDocType) setDocType(next.defaultDocType);
    setVisibility(next.defaultVisibility);
    if (next.scope === "STANDING") setProductionId("none");
    if (next.scope === "PRODUCTION" && productionId === "none") setProductionId("");
    setTemplateId("blank");
  }

  // Success view: the file exists, so the useful next step is opening it.
  if (state.documentId && !state.error) {
    return (
      <Card className="text-center">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <Icon name="check-circle" className="size-5" />
        </span>
        <h2 className="text-base font-semibold">{state.ok}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
          It has been named <span className="font-medium text-ink-700">{previewName}</span> and filed
          in {category?.name}
          {production ? ` · ${production.name}` : ""}.
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
          {state.openUrl ? (
            <a
              href={state.openUrl}
              target={driveMode === "mock" ? undefined : "_blank"}
              rel="noreferrer"
              className={buttonClass("primary")}
            >
              <Icon name="external" className="size-4" />
              Open {DOC_TYPE_META[docType as keyof typeof DOC_TYPE_META]?.label ?? "document"}
            </a>
          ) : null}
          <Link href={`/documents/${state.documentId}`} className={buttonClass("secondary")}>
            View on the hub
          </Link>
          <a href="/documents/new" className={buttonClass("ghost")}>
            Create another
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
          label="Name"
          htmlFor="title"
          required
          hint="Plain language, no need to add the show or the date — the hub adds those."
        >
          <input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Running budget"
            className={inputClass}
            required
            autoFocus
          />
        </Field>

        <Field label="What should it be?" required>
          <RadioCards
            name="docType"
            value={docType}
            onChange={(next) => {
              setDocType(next);
              setTemplateId("blank");
            }}
            options={CREATABLE_DOC_TYPES.map((type) => ({
              value: type,
              label: DOC_TYPE_META[type].label,
              icon: DOC_TYPE_META[type].icon,
              tint: DOC_TYPE_META[type].color,
              description:
                type === "SHEET"
                  ? "Budgets, contact sheets, inventories"
                  : type === "DOC"
                    ? "Reports, minutes, riders"
                    : "Pitches, design presentations",
            }))}
          />
        </Field>

        <CategorySelect categories={categories} value={categoryId} onChange={pickCategory} />

        <ProductionSelect
          productions={productions}
          value={productionId}
          onChange={setProductionId}
          scope={category?.scope}
        />

        {availableTemplates.length > 0 ? (
          <Field
            label="Start from a template"
            htmlFor="templateId"
            hint="Templates are set up by admins. Placeholders like {{TITLE}} and {{PRODUCTION}} get filled in for you."
          >
            <select
              id="templateId"
              name="templateId"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className={selectClass}
            >
              <option value="blank">Blank {DOC_TYPE_META[docType as "DOC"].label}</option>
              {availableTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <input type="hidden" name="templateId" value="blank" />
        )}
      </Card>

      <Card className="space-y-5">
        <VisibilityPicker value={visibility} onChange={setVisibility} groupEmail={groupEmail} />
        <DescriptionField />
        <TagsField />
      </Card>

      <div className="card flex flex-wrap items-center justify-between gap-3 bg-ink-50 p-4">
        <div className="min-w-0 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Will be created as
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-medium text-ink-800">
            <Icon
              name={DOC_TYPE_META[docType as "DOC"].icon}
              className="size-4 shrink-0"
            />
            <span className="truncate">{previewName}</span>
          </div>
          <div className="mt-1 text-xs text-ink-500">
            {category
              ? `Drive folder: ${
                  production ? `Productions / ${production.name} / ` : "Organisation-wide / "
                }${category.name}`
              : "Pick a category to see where it will be filed."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/documents" className={buttonClass("ghost")}>
            Cancel
          </Link>
          <SubmitButton icon="plus" pendingLabel="Creating in Drive…">
            Create document
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
