"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createDocumentAction } from "@/app/actions/documents";
import { emptyState } from "@/app/actions/shared";
import {
  CANVA_EXPORT_FORMATS,
  CANVA_FORMAT_META,
  CREATION_MODES,
  DOC_TYPE_META,
  docTypeFromMime,
  type CanvaExportFormat,
  type CreationMode,
  type DocType,
} from "@/lib/constants";
import { applyNamingTemplate, fileNameToTitle, withExtension } from "@/lib/utils";
import { uploadFile, type UploadResult } from "@/lib/upload-client";
import { Card, Field, buttonClass, inputClass, selectClass } from "../ui";
import { Icon } from "../icons";
import { FormBanner, RadioCards, SubmitButton } from "./form-bits";
import { FilePicker, fileKey, type UploadState } from "./file-picker";
import {
  CategorySelect,
  DescriptionField,
  EditAccessPicker,
  ProductionSelect,
  TagsField,
  VisibilityPicker,
  type FormCategory,
  type FormProduction,
  type FormTemplate,
} from "./document-fields";

const MODE_COPY: Record<CreationMode, { label: string; icon: string; tint: string; blurb: string }> =
  {
    DOC: {
      label: "Google Doc",
      icon: "doc",
      tint: DOC_TYPE_META.DOC.color,
      blurb: "Reports, minutes, riders",
    },
    SHEET: {
      label: "Google Sheet",
      icon: "sheet",
      tint: DOC_TYPE_META.SHEET.color,
      blurb: "Budgets, contact sheets, inventories",
    },
    SLIDES: {
      label: "Google Slides",
      icon: "slides",
      tint: DOC_TYPE_META.SLIDES.color,
      blurb: "Pitches, design presentations",
    },
    FORM: {
      label: "Google Form",
      icon: "form",
      tint: DOC_TYPE_META.FORM.color,
      blurb: "Auditions, availability, feedback",
    },
    UPLOAD: {
      label: "Upload a file",
      icon: "upload",
      tint: "#dc2626",
      blurb: "Scripts, scores, PDFs, scans, images",
    },
    CANVA: {
      label: "Canva design",
      icon: "canva",
      tint: DOC_TYPE_META.CANVA.color,
      blurb: "Paste a link — the hub keeps a copy people can open",
    },
  };

export function DocumentCreateForm({
  categories,
  productions,
  templates,
  namingTemplate,
  currentSeason,
  boardCount,
  driveMode,
  canvaMode,
  canvaReady,
  canvaAccountLabel,
  companyCreatorOnly = false,
  defaultCategoryId,
  defaultProductionId,
}: {
  categories: FormCategory[];
  productions: FormProduction[];
  templates: FormTemplate[];
  namingTemplate: string;
  currentSeason: string | null;
  boardCount: number | null;
  driveMode: "google" | "mock";
  canvaMode: "canva" | "mock" | "off";
  canvaReady: boolean;
  canvaAccountLabel: string | null;
  /** True for a company member filing for their own show. */
  companyCreatorOnly?: boolean;
  defaultCategoryId?: string;
  defaultProductionId?: string;
}) {
  const [state, formAction] = useActionState(createDocumentAction, emptyState);
  const formRef = useRef<HTMLFormElement>(null);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [productionId, setProductionId] = useState(defaultProductionId ?? "none");
  const [mode, setMode] = useState<CreationMode>("DOC");
  /** Whether the person picked the file type, as opposed to inheriting it. */
  const [typeChosenByHand, setTypeChosenByHand] = useState(false);
  const [visibility, setVisibility] = useState<string>(companyCreatorOnly ? "COMPANY" : "BOARD");
  const [editAccess, setEditAccess] = useState<string>("BOARD");
  const [templateId, setTemplateId] = useState("blank");
  const [canvaFormat, setCanvaFormat] = useState<CanvaExportFormat>("pdf");

  // Upload mode
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);

  const category = categories.find((item) => item.id === categoryId);
  const production = productions.find((item) => item.id === productionId);
  const isUpload = mode === "UPLOAD";
  const isCanva = mode === "CANVA";

  const availableTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.docType === mode && (!template.categoryId || template.categoryId === categoryId),
      ),
    [templates, mode, categoryId],
  );

  const effectiveTitle =
    title.trim() || (isUpload && files.length === 1 ? fileNameToTitle(files[0].name) : "");

  const previewBase = applyNamingTemplate(namingTemplate, {
    production: production?.abbreviation || production?.name || null,
    category: category?.name,
    title: effectiveTitle || (isUpload && files.length > 1 ? "each file's own name" : "Untitled"),
    season: production?.season ?? currentSeason,
  });
  const previewName = isCanva
    ? withExtension(previewBase, CANVA_FORMAT_META[canvaFormat].extension)
    : isUpload && files.length === 1
      ? withExtension(previewBase, files[0].name)
      : previewBase;

  const uploadDocType: DocType =
    isUpload && files.length > 0 ? docTypeFromMime(files[0].type) : "OTHER";
  const previewIcon = isUpload ? DOC_TYPE_META[uploadDocType].icon : MODE_COPY[mode].icon;

  function pickCategory(nextId: string) {
    setCategoryId(nextId);
    const next = categories.find((item) => item.id === nextId);
    if (!next) return;
    /**
     * A category's default file type is a suggestion for somebody who has not
     * said what they want yet. Once they have picked a type themselves it is
     * theirs, and choosing a category must not quietly undo it.
     *
     * This used to be a list of exempt types (upload, Canva), which meant
     * every new type arrived broken — Form was silently switched to Sheet by
     * picking a category whose default is Sheet. Tracking whether the choice
     * was deliberate fixes the whole class instead of the latest instance.
     */
    if (next.defaultDocType && !typeChosenByHand) {
      setMode(next.defaultDocType as CreationMode);
    }
    // Never leave "Company" selected on a category that is board-only.
    const wanted =
      next.defaultVisibility === "COMPANY" && !next.companyVisible
        ? "BOARD"
        : next.defaultVisibility;
    // A company member cannot publish to the board, so fall back to Company.
    setVisibility(companyCreatorOnly && wanted === "BOARD" ? "COMPANY" : wanted);
    setEditAccess(next.defaultEditAccess);
    if (next.scope === "STANDING") setProductionId("none");
    if (next.scope === "PRODUCTION" && productionId === "none") setProductionId("");
    setTemplateId("blank");
  }

  function addFiles(incoming: File[]) {
    setFiles(incoming);
    // One file and no name yet? Use the file's own name — nobody wants to type
    // "Urinetown script" when the file is already called that.
    if (incoming.length === 1 && !title.trim()) setTitle(fileNameToTitle(incoming[0].name));
  }

  async function handleUpload() {
    setUploadError(null);

    if (!categoryId) return setUploadError("Pick a category first.");
    if (category?.scope === "PRODUCTION" && (!productionId || productionId === "none")) {
      return setUploadError(`Documents in ${category.name} have to be attached to a production.`);
    }
    if (files.length === 0) return setUploadError("Choose at least one file.");
    if (files.length === 1 && !effectiveTitle) return setUploadError("Give the file a name.");

    const form = formRef.current ? new FormData(formRef.current) : null;
    const description = String(form?.get("description") ?? "").trim() || undefined;
    const tags = String(form?.get("tags") ?? "").trim() || undefined;

    setUploading(true);
    const results: UploadResult[] = [];

    for (const file of files) {
      const key = fileKey(file);
      setUploads((current) => ({ ...current, [key]: { pct: 0, status: "uploading" } }));
      try {
        const result = await uploadFile({
          file,
          start: {
            mode: "new",
            // With several files, each keeps its own name; with one, the name
            // the person typed wins.
            title: files.length === 1 ? effectiveTitle : fileNameToTitle(file.name),
            description,
            categoryId,
            productionId: productionId === "none" ? undefined : productionId,
            visibility,
            tags,
          },
          onProgress: (pct) =>
            setUploads((current) => ({ ...current, [key]: { pct, status: "uploading" } })),
        });
        results.push(result);
        setUploads((current) => ({
          ...current,
          [key]: { pct: 100, status: "done", documentId: result.documentId },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The upload failed.";
        setUploads((current) => ({ ...current, [key]: { pct: 100, status: "error", error: message } }));
      }
    }

    setUploading(false);
    if (results.length > 0) setUploadResults(results);
    else setUploadError("Nothing was uploaded. See the errors above the button.");
  }

  // --- success views --------------------------------------------------------

  if (uploadResults.length > 0) {
    const warnings = uploadResults.flatMap((result) => result.warnings);
    return (
      <Card className="text-center">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <Icon name="check-circle" className="size-5" />
        </span>
        <h2 className="text-base font-semibold">
          {uploadResults.length === 1
            ? `“${uploadResults[0].title}” is filed and ready.`
            : `${uploadResults.length} files are filed and ready.`}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
          Filed in {category?.name}
          {production ? ` · ${production.name}` : ""}, named to the hub's rule and shared with
          whoever the visibility allows.
        </p>

        {warnings.length > 0 ? (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {uploadResults.length > 1 ? (
          <ul className="mx-auto mt-4 max-w-md divide-y divide-ink-100 rounded-xl border border-ink-200 text-left">
            {uploadResults.map((result) => (
              <li key={result.documentId}>
                <Link
                  href={`/documents/${result.documentId}`}
                  className="flex items-center gap-2 p-2.5 text-sm hover:bg-ink-50"
                >
                  <Icon name="file" className="size-4 shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1 truncate">{result.title}</span>
                  <Icon name="chevron-right" className="size-3.5 shrink-0 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {uploadResults.length === 1 && uploadResults[0].webViewLink ? (
            <a
              href={uploadResults[0].webViewLink}
              target={driveMode === "mock" ? undefined : "_blank"}
              rel="noreferrer"
              className={buttonClass("primary")}
            >
              <Icon name="external" className="size-4" />
              Open the file
            </a>
          ) : null}
          {uploadResults.length === 1 ? (
            <Link href={`/documents/${uploadResults[0].documentId}`} className={buttonClass("secondary")}>
              View on the hub
            </Link>
          ) : null}
          <a href="/documents/new" className={buttonClass("ghost")}>
            Add something else
          </a>
        </div>
      </Card>
    );
  }

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
              Open {MODE_COPY[mode].label}
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

  // --- the form ------------------------------------------------------------

  const multiFile = isUpload && files.length > 1;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        // Upload mode does its own thing (bytes go straight to Drive), so keep
        // a stray Enter keypress from firing the create-a-Google-file action.
        if (isUpload) {
          event.preventDefault();
          void handleUpload();
        }
      }}
      className="space-y-6"
    >
      <FormBanner state={uploadError ? { ...state, error: uploadError } : state} />

      <Card className="space-y-5">
        <Field label="What should it be?" required>
          <RadioCards
            name="docType"
            value={mode}
            onChange={(next) => {
              setMode(next as CreationMode);
              // From here on the category's default type must not override it.
              setTypeChosenByHand(true);
              setTemplateId("blank");
              if (next !== "UPLOAD") setFiles([]);
            }}
            options={CREATION_MODES.filter(
              (option) => option !== "CANVA" || canvaMode !== "off",
            ).map((option) => ({
              value: option,
              label: MODE_COPY[option].label,
              icon: MODE_COPY[option].icon,
              tint: MODE_COPY[option].tint,
              description: MODE_COPY[option].blurb,
            }))}
            columns={2}
          />
        </Field>

        {isUpload ? (
          <Field
            label="File"
            required
            hint="The hub uploads it to the club's Drive, renames it to the naming rule and shares it — same as anything created here."
          >
            <FilePicker
              files={files}
              onFiles={addFiles}
              onRemove={(index) => setFiles(files.filter((_, i) => i !== index))}
              progress={uploads}
              disabled={uploading}
            />
          </Field>
        ) : null}

        {isCanva ? (
          <>
            <Field
              label="Canva link"
              htmlFor="canvaLink"
              required
              hint={
                canvaMode === "mock"
                  ? "Any Canva link works while the hub is running on a simulated Canva — you will get a placeholder export so you can see the whole flow."
                  : canvaReady
                    ? `Open the design in Canva, copy the URL from the address bar, and make sure it is shared with ${canvaAccountLabel ?? "the hub's Canva account"} so the hub can export it.`
                    : "The hub's Canva account is not connected yet — an admin needs to do that in Admin before this will work."
              }
            >
              <input
                id="canvaLink"
                name="canvaLink"
                className={inputClass}
                placeholder="https://www.canva.com/design/DAF.../view"
                required
              />
            </Field>

            <Field
              label="Keep the copy as"
              hint="Canva cannot let the hub decide who opens a design, so the hub keeps an exported copy in Drive instead — and that copy follows the hub's own Private / Company / Board rules. Canva stays the place you edit it."
            >
              <RadioCards
                name="canvaFormat"
                columns={2}
                value={canvaFormat}
                onChange={(next) => setCanvaFormat(next as CanvaExportFormat)}
                options={CANVA_EXPORT_FORMATS.map((format) => ({
                  value: format,
                  label: CANVA_FORMAT_META[format].label,
                  description: CANVA_FORMAT_META[format].blurb,
                  icon: format === "pdf" ? "pdf" : "slides",
                  tint: format === "pdf" ? DOC_TYPE_META.PDF.color : DOC_TYPE_META.SLIDES.color,
                }))}
              />
            </Field>
          </>
        ) : null}

        <Field
          label={multiFile ? "Name" : "Name"}
          htmlFor="title"
          required={!multiFile && !isCanva}
          hint={
            multiFile
              ? "Several files selected — each one keeps its own name. Clear the extra files if you want to name one yourself."
              : isCanva
                ? "Leave blank to use the design's own name in Canva."
                : "Plain language, no need to add the show or the date — the hub adds those."
          }
        >
          <input
            id="title"
            name="title"
            value={multiFile ? "" : title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={multiFile ? "Each file keeps its own name" : "Running budget"}
            className={inputClass}
            required={!isUpload && !isCanva}
            disabled={multiFile}
            autoFocus={!isUpload}
          />
        </Field>

        <CategorySelect categories={categories} value={categoryId} onChange={pickCategory} />

        <ProductionSelect
          productions={productions}
          value={productionId}
          onChange={setProductionId}
          scope={category?.scope}
        />

        {!isUpload && !isCanva && availableTemplates.length > 0 ? (
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
              <option value="blank">Blank {MODE_COPY[mode].label}</option>
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
        <VisibilityPicker
          value={visibility}
          onChange={setVisibility}
          boardCount={boardCount}
          category={category}
          companyCreatorOnly={companyCreatorOnly}
        />
        <EditAccessPicker
          value={editAccess}
          onChange={setEditAccess}
          visibility={visibility}
          category={category}
        />
        <DescriptionField />
        <TagsField />
      </Card>

      <div className="card flex flex-wrap items-center justify-between gap-3 bg-ink-50 p-4">
        <div className="min-w-0 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Will be {isUpload ? "uploaded as" : isCanva ? "kept in Drive as" : "created as"}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-medium text-ink-800">
            <Icon name={previewIcon} className="size-4 shrink-0" />
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
          {isUpload ? (
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || files.length === 0}
              className={buttonClass("primary")}
            >
              <Icon
                name={uploading ? "refresh" : "upload"}
                className={uploading ? "size-4 animate-spin" : "size-4"}
              />
              {uploading
                ? "Uploading…"
                : files.length > 1
                  ? `Upload ${files.length} files`
                  : "Upload"}
            </button>
          ) : (
            <SubmitButton
              icon={isCanva ? "canva" : "plus"}
              pendingLabel={isCanva ? "Exporting from Canva…" : "Creating in Drive…"}
            >
              {isCanva ? "Mirror this design" : "Create document"}
            </SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}
