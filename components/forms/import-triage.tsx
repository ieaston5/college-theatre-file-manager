"use client";

import { useActionState, useMemo, useState } from "react";
import { fileItemsAction, skipItemsAction } from "@/app/actions/import";
import { emptyState } from "@/app/actions/shared";
import { DOC_TYPE_META, VISIBILITIES, VISIBILITY_META, docTypeFromMime } from "@/lib/constants";
import { cn, formatBytes, relativeTime } from "@/lib/utils";
import { Icon } from "../icons";
import { Badge, buttonClass, selectClass } from "../ui";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

export type TriageItem = {
  id: string;
  name: string;
  mimeType: string | null;
  ownerEmail: string | null;
  /** The shared drive it came from; Drive reports no owner for those. */
  driveName: string | null;
  folderPath: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  guessedCategoryId: string | null;
  guessedProductionId: string | null;
  confidence: number;
  suggestedTitle: string;
};

export type TriageCategory = {
  id: string;
  name: string;
  scope: string;
  companyVisible: boolean;
  defaultVisibility: string;
};

export type TriageProduction = { id: string; name: string };

type RowState = { categoryId: string; productionId: string; visibility: string; selected: boolean };

/**
 * The triage table. The important property is that nothing here costs a page
 * load: tick a dozen rows, set the category once with the bulk control, file
 * them. Filing a hundred files should be a few minutes, not an afternoon.
 */
export function ImportTriage({
  items,
  categories,
  productions,
  hubAccountEmail,
}: {
  items: TriageItem[];
  categories: TriageCategory[];
  productions: TriageProduction[];
  hubAccountEmail: string | null;
}) {
  const [fileState, fileAction] = useActionState(fileItemsAction, emptyState);

  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      items.map((item) => {
        const category = categories.find((entry) => entry.id === item.guessedCategoryId);
        return [
          item.id,
          {
            categoryId: item.guessedCategoryId ?? "",
            productionId: item.guessedProductionId ?? "none",
            visibility: category?.defaultVisibility ?? "BOARD",
            selected: Boolean(item.guessedCategoryId),
          },
        ];
      }),
    ),
  );

  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkProduction, setBulkProduction] = useState("");
  const [bulkVisibility, setBulkVisibility] = useState("");

  const selectedIds = useMemo(
    () => Object.entries(rows).filter(([, row]) => row.selected).map(([id]) => id),
    [rows],
  );

  function update(id: string, patch: Partial<RowState>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function applyBulk() {
    setRows((current) => {
      const next = { ...current };
      for (const id of selectedIds) {
        next[id] = {
          ...next[id],
          ...(bulkCategory ? { categoryId: bulkCategory } : {}),
          ...(bulkProduction ? { productionId: bulkProduction } : {}),
          ...(bulkVisibility ? { visibility: bulkVisibility } : {}),
        };
        // A category that must not be company-visible cannot stay on Company.
        const category = categories.find((entry) => entry.id === next[id].categoryId);
        if (next[id].visibility === "COMPANY" && category && !category.companyVisible) {
          next[id] = { ...next[id], visibility: "BOARD" };
        }
        if (category?.scope === "STANDING") next[id] = { ...next[id], productionId: "none" };
      }
      return next;
    });
    setBulkCategory("");
    setBulkProduction("");
    setBulkVisibility("");
  }

  function setAllSelected(selected: boolean) {
    setRows((current) =>
      Object.fromEntries(Object.entries(current).map(([id, row]) => [id, { ...row, selected }])),
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-ink-300 bg-white p-6 text-center text-sm text-ink-500">
        Everything in this scan has been dealt with.
      </p>
    );
  }

  const compact = "rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700";

  return (
    <form action={fileAction} className="space-y-4">
      <FormBanner state={fileState} />

      {/* Bulk controls */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
        <div className="mr-auto text-xs text-ink-600">
          <div className="font-semibold text-ink-800">
            {selectedIds.length} of {items.length} selected
          </div>
          <div className="mt-0.5 flex gap-2">
            <button
              type="button"
              onClick={() => setAllSelected(true)}
              className="underline hover:text-ink-900"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setAllSelected(false)}
              className="underline hover:text-ink-900"
            >
              None
            </button>
          </div>
        </div>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-600">Set category</span>
          <select
            value={bulkCategory}
            onChange={(event) => setBulkCategory(event.target.value)}
            className={compact}
          >
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-600">Set production</span>
          <select
            value={bulkProduction}
            onChange={(event) => setBulkProduction(event.target.value)}
            className={compact}
          >
            <option value="">—</option>
            <option value="none">Not tied to a show</option>
            {productions.map((production) => (
              <option key={production.id} value={production.id}>
                {production.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-600">Set visibility</span>
          <select
            value={bulkVisibility}
            onChange={(event) => setBulkVisibility(event.target.value)}
            className={compact}
          >
            <option value="">—</option>
            {VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {VISIBILITY_META[visibility].label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={applyBulk}
          disabled={selectedIds.length === 0 || (!bulkCategory && !bulkProduction && !bulkVisibility)}
          className={buttonClass("secondary", "text-xs")}
        >
          Apply to selected
        </button>
      </div>

      <ul className="card divide-y divide-ink-100 overflow-hidden p-0">
        {items.map((item) => {
          const row = rows[item.id];
          const category = categories.find((entry) => entry.id === row.categoryId);
          const docType = docTypeFromMime(item.mimeType);
          const meta = DOC_TYPE_META[docType];
          const foreign = Boolean(
            item.ownerEmail && hubAccountEmail && item.ownerEmail !== hubAccountEmail,
          );

          return (
            <li
              key={item.id}
              className={cn("px-3 py-2.5 transition", row.selected ? "bg-brand-50/40" : "bg-white")}
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="checkbox"
                  name="selected"
                  value={item.id}
                  checked={row.selected}
                  onChange={(event) => update(item.id, { selected: event.target.checked })}
                  className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                  aria-label={`Select ${item.name}`}
                />

                <span
                  className="grid size-7 shrink-0 place-items-center rounded"
                  style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                >
                  <Icon name={meta.icon} className="size-3.5" />
                </span>

                <span className="min-w-52 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {item.webViewLink ? (
                      <a
                        href={item.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-sm font-medium text-ink-900 hover:text-brand-700"
                      >
                        {item.name}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-medium text-ink-900">{item.name}</span>
                    )}
                    {item.confidence >= 40 ? (
                      <Badge tone="green">guessed</Badge>
                    ) : item.confidence > 0 ? (
                      <Badge tone="amber">unsure</Badge>
                    ) : (
                      <Badge tone="slate">no guess</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-500">
                    {item.folderPath ? `${item.folderPath} · ` : ""}
                    {/* A shared drive owns its files, so there is no owner to
                        show and no handover to arrange — naming the drive is
                        both more accurate and more useful than "unknown". */}
                    {item.driveName
                      ? `${item.driveName} (shared drive)`
                      : (item.ownerEmail ?? "unknown owner")}
                    {foreign ? " (not the hub's account)" : ""}
                    {item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                    {item.modifiedAt ? ` · changed ${relativeTime(item.modifiedAt)}` : ""}
                  </span>
                </span>

                <select
                  name={`category:${item.id}`}
                  value={row.categoryId}
                  onChange={(event) => {
                    const nextCategory = categories.find(
                      (entry) => entry.id === event.target.value,
                    );
                    update(item.id, {
                      categoryId: event.target.value,
                      selected: true,
                      visibility:
                        row.visibility === "COMPANY" && nextCategory && !nextCategory.companyVisible
                          ? "BOARD"
                          : row.visibility,
                      productionId:
                        nextCategory?.scope === "STANDING" ? "none" : row.productionId,
                    });
                  }}
                  className={cn(compact, "w-40", !row.categoryId && "border-amber-300")}
                  aria-label={`Category for ${item.name}`}
                >
                  <option value="">Pick a category…</option>
                  {categories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>

                <select
                  name={`production:${item.id}`}
                  value={row.productionId}
                  onChange={(event) => update(item.id, { productionId: event.target.value })}
                  disabled={category?.scope === "STANDING"}
                  className={cn(compact, "w-36")}
                  aria-label={`Production for ${item.name}`}
                >
                  <option value="none">No show</option>
                  {productions.map((production) => (
                    <option key={production.id} value={production.id}>
                      {production.name}
                    </option>
                  ))}
                </select>

                <select
                  name={`visibility:${item.id}`}
                  value={row.visibility}
                  onChange={(event) => update(item.id, { visibility: event.target.value })}
                  className={cn(compact, "w-28")}
                  aria-label={`Visibility for ${item.name}`}
                >
                  {VISIBILITIES.filter(
                    (visibility) => visibility !== "COMPANY" || category?.companyVisible,
                  ).map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {VISIBILITY_META[visibility].label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border border-ink-200 bg-white p-3">
        <Toggle
          name="renameInDrive"
          label="Rename these in Drive to match the hub's naming rule"
          hint="Turns “urinetown light plot v2” into “[URINETOWN] urinetown light plot — Design & tech”, keeping any file extension. Needs edit access, which the hub only has on files it owns or has been given — anything it cannot rename keeps its current name and is listed afterwards. The file does not move folders either way."
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">
          Filing records where a file belongs and shares it to match. The file itself stays where it
          is in Drive, owned by whoever owns it now.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            formAction={skipItemsAction}
            disabled={selectedIds.length === 0}
            className={buttonClass("secondary")}
          >
            <Icon name="x" className="size-4" />
            Skip selected
          </button>
          <SubmitButton icon="check" pendingLabel="Filing…">
            File {selectedIds.length > 0 ? selectedIds.length : ""}{" "}
            {selectedIds.length === 1 ? "file" : "files"}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
