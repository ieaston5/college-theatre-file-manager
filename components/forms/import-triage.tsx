"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fileImportChunkAction,
  finishFilingAction,
  skipItemsAction,
  type TriageDecision,
} from "@/app/actions/import";
import {
  DOC_TYPE_META,
  IMPORT_FILE_CHUNK,
  VISIBILITIES,
  VISIBILITY_META,
  docTypeFromMime,
} from "@/lib/constants";
import { cn, formatBytes, pluralize, relativeTime } from "@/lib/utils";
import { Icon } from "../icons";
import { Badge, buttonClass } from "../ui";
import { ProgressBar } from "../progress";
import { hasProduction } from "./document-fields";
import { Toggle } from "./form-bits";

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

/** What the filing run has got through so far. */
type FilingProgress = {
  total: number;
  filed: number;
  renamed: number;
  failures: Array<{ name: string; reason: string }>;
  renameFailures: Array<{ name: string; reason: string }>;
  done: boolean;
};

/**
 * The triage table. The important property is that nothing here costs a page
 * load: tick a dozen rows, set the category once with the bulk control, file
 * them. Filing a hundred files should be a few minutes, not an afternoon.
 *
 * Filing itself is the one genuinely slow thing on the page, and for a good
 * reason: each file is a database write, a Drive sharing pass, a label, and
 * sometimes a rename. So it is done a few files at a time and counted, because
 * "24 of 60 filed" is worth waiting next to and a spinning button is not — and
 * because a run that is interrupted has really filed the files it says it has.
 */
export function ImportTriage({
  batchId,
  items,
  categories,
  productions,
  hubAccountEmail,
}: {
  /** The scan these items belong to, for the one activity entry at the end. */
  batchId: string;
  items: TriageItem[];
  categories: TriageCategory[];
  productions: TriageProduction[];
  hubAccountEmail: string | null;
}) {
  const router = useRouter();
  const [filing, startFiling] = useTransition();
  const [progress, setProgress] = useState<FilingProgress | null>(null);
  const [renameInDrive, setRenameInDrive] = useState(false);

  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      items.map((item) => {
        const category = categories.find((entry) => entry.id === item.guessedCategoryId);
        const productionId = item.guessedProductionId ?? "none";
        const guessed = category?.defaultVisibility ?? "BOARD";
        return [
          item.id,
          {
            categoryId: item.guessedCategoryId ?? "",
            productionId,
            // A category whose default is Company still lands on Board when
            // the file is not going onto a show.
            visibility: guessed === "COMPANY" && !hasProduction(productionId) ? "BOARD" : guessed,
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
        const category = categories.find((entry) => entry.id === next[id].categoryId);
        if (category?.scope === "STANDING") next[id] = { ...next[id], productionId: "none" };
        // A category that must not be company-visible cannot stay on Company —
        // and nor can a file going onto no show, because "Company" means the
        // people on one show.
        if (
          next[id].visibility === "COMPANY" &&
          ((category && !category.companyVisible) || !hasProduction(next[id].productionId))
        ) {
          next[id] = { ...next[id], visibility: "BOARD" };
        }
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

  /**
   * File everything ticked, a few files at a time, counting as it goes.
   *
   * The decisions are taken from the table's own state up front, so what gets
   * filed is what was on screen when the button was pressed — changing a row
   * mid-run cannot half-apply to a file already gone.
   */
  function fileSelected() {
    const decisions: TriageDecision[] = selectedIds
      .filter((id) => rows[id]?.categoryId)
      .map((id) => ({
        itemId: id,
        categoryId: rows[id].categoryId,
        productionId: rows[id].productionId,
        visibility: rows[id].visibility,
      }));

    const withoutCategory = selectedIds.length - decisions.length;
    const run: FilingProgress = {
      total: decisions.length,
      filed: 0,
      renamed: 0,
      failures: [],
      renameFailures: [],
      done: decisions.length === 0,
    };
    setProgress(run);
    if (decisions.length === 0) return;

    startFiling(async () => {
      let filed = 0;
      let renamed = 0;
      const failures: Array<{ name: string; reason: string }> = [];
      const renameFailures: Array<{ name: string; reason: string }> = [];

      for (let start = 0; start < decisions.length; start += IMPORT_FILE_CHUNK) {
        const slice = decisions.slice(start, start + IMPORT_FILE_CHUNK);
        try {
          const result = await fileImportChunkAction({ decisions: slice, renameInDrive });
          filed += result.filed;
          renamed += result.renamed;
          failures.push(...result.failures);
          renameFailures.push(...result.renameFailures);
        } catch (error) {
          // A slice that fails outright — the connection went, the host timed
          // out — is named and the run carries on with the next one, rather
          // than losing the files that were already filed.
          failures.push({
            name: `${slice.length} ${pluralize(slice.length, "file")}`,
            reason: error instanceof Error ? error.message : "the request failed",
          });
        }
        setProgress({
          total: decisions.length,
          filed,
          renamed,
          failures: [...failures],
          renameFailures: [...renameFailures],
          done: start + IMPORT_FILE_CHUNK >= decisions.length,
        });
      }

      if (withoutCategory > 0) {
        failures.push({
          name: `${withoutCategory} ${pluralize(withoutCategory, "file")}`,
          reason: "no category was picked",
        });
        setProgress((current) =>
          current ? { ...current, failures: [...failures], done: true } : current,
        );
      }

      // One activity entry for the run, and one refresh of the lists whose
      // counts have moved — including this table, which the filed rows leave.
      await finishFilingAction(batchId);
      router.refresh();
    });
  }

  /**
   * Nothing left to triage — but the report of the run that emptied it stays.
   *
   * Filing refreshes the page when it finishes, which takes the rows that were
   * filed out of this table; on the last screenful that leaves nothing to
   * render at all. Dropping the report with them would be the worst moment to
   * do it, because that is exactly when it says how many landed and which ones
   * Drive refused.
   */
  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <FilingReport progress={progress} running={filing} />
        <p className="rounded-xl border border-dashed border-ink-300 bg-white p-6 text-center text-sm text-ink-500">
          Everything in this scan has been dealt with.
        </p>
      </div>
    );
  }

  const compact = "rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700";

  return (
    // The form is here for "Skip selected", which posts the ticked ids the
    // ordinary way. Filing is driven from fileSelected instead, because it
    // takes several requests and reports on each of them.
    <form action={skipItemsAction} className="space-y-4">
      <FilingReport progress={progress} running={filing} />

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
                    const nextProductionId =
                      nextCategory?.scope === "STANDING" ? "none" : row.productionId;
                    const companyGone =
                      (nextCategory && !nextCategory.companyVisible) ||
                      !hasProduction(nextProductionId);
                    update(item.id, {
                      categoryId: event.target.value,
                      selected: true,
                      visibility:
                        row.visibility === "COMPANY" && companyGone ? "BOARD" : row.visibility,
                      productionId: nextProductionId,
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
                  onChange={(event) =>
                    update(item.id, {
                      productionId: event.target.value,
                      // Taking the show off takes "Company" with it.
                      visibility:
                        row.visibility === "COMPANY" && !hasProduction(event.target.value)
                          ? "BOARD"
                          : row.visibility,
                    })
                  }
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
                    (visibility) =>
                      visibility !== "COMPANY" ||
                      (category?.companyVisible && hasProduction(row.productionId)),
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
          label="Rename these in Drive too, to match the hub's naming rule"
          hint="The hub lists them by its naming rule either way — “urinetown light plot v2” becomes “[URINETOWN] urinetown light plot — Design & tech”. This also renames the file itself, keeping any extension, so Drive matches. Needs edit access, which the hub only has on files it owns or has been given; anything it cannot rename keeps its current name in Drive and is listed afterwards. The file does not move folders either way."
          checked={renameInDrive}
          onChange={setRenameInDrive}
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
            disabled={selectedIds.length === 0 || filing}
            className={buttonClass("secondary")}
          >
            <Icon name="x" className="size-4" />
            Skip selected
          </button>
          <button
            type="button"
            onClick={fileSelected}
            disabled={selectedIds.length === 0 || filing}
            className={buttonClass("primary")}
          >
            <Icon name={filing ? "refresh" : "check"} className={filing ? "size-4 animate-spin" : "size-4"} />
            {filing
              ? `Filing ${progress ? `${progress.filed} of ${progress.total}` : "…"}`
              : `File ${selectedIds.length > 0 ? selectedIds.length : ""} ${pluralize(
                  selectedIds.length,
                  "file",
                )}`}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * What filing has done so far: the bar while it runs, and what landed or
 * refused when it stops.
 *
 * The failures are the point of keeping this on screen afterwards. A file the
 * hub could not take — the category went away, Drive refused the share — is
 * still sitting in the list waiting to be dealt with, and a run that quietly
 * filed 57 of 60 would leave somebody believing the folder was done.
 */
function FilingReport({
  progress,
  running,
}: {
  progress: FilingProgress | null;
  running: boolean;
}) {
  if (!progress) return null;

  if (progress.total === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span>Pick a category for the files you ticked first — nothing was filed.</span>
        </div>
      </div>
    );
  }

  const finished = progress.done && !running;

  return (
    <div
      className={
        finished && progress.failures.length === 0
          ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          : "rounded-xl border border-ink-200 bg-white p-4"
      }
      aria-live="polite"
    >
      <ProgressBar
        value={progress.filed}
        max={progress.total}
        tone={progress.failures.length > 0 ? "amber" : "brand"}
        label={
          finished
            ? `Filed ${progress.filed} of ${progress.total} ${pluralize(progress.total, "file")}${
                progress.renamed > 0 ? `, renamed ${progress.renamed} in Drive` : ""
              }`
            : `Filing — ${progress.filed} of ${progress.total} done`
        }
      />

      {!finished ? (
        <p className="mt-2 text-xs text-ink-500">
          Each file is a Drive sharing pass of its own, so this takes a moment per file. Anything
          already counted is filed and stays filed.
        </p>
      ) : null}

      {finished && progress.failures.length === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
          <Icon name="check-circle" className="size-3.5" />
          They are on the dashboard now.
        </p>
      ) : null}

      {progress.failures.length > 0 ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <p className="font-medium">
            {progress.failures.length} {pluralize(progress.failures.length, "file")} could not be
            filed, so {progress.failures.length === 1 ? "it is" : "they are"} still in the list:
          </p>
          <ul className="mt-1 space-y-0.5">
            {progress.failures.slice(0, 8).map((failure, index) => (
              // Two files can share a name and a reason, so position is the
              // only unique thing about a row.
              <li key={`${index}:${failure.name}`}>
                {failure.name} — {failure.reason}
              </li>
            ))}
          </ul>
          {progress.failures.length > 8 ? (
            <p className="mt-1">and {progress.failures.length - 8} more.</p>
          ) : null}
        </div>
      ) : null}

      {progress.renameFailures.length > 0 ? (
        <p className="mt-2 text-xs text-amber-800">
          {progress.renameFailures.length}{" "}
          {pluralize(progress.renameFailures.length, "file")} filed but kept{" "}
          {progress.renameFailures.length === 1 ? "its" : "their"} Drive name — the hub cannot edit{" "}
          {progress.renameFailures.length === 1 ? "it" : "them"}:{" "}
          {progress.renameFailures
            .slice(0, 4)
            .map((failure) => failure.name)
            .join(", ")}
          {progress.renameFailures.length > 4 ? ", …" : ""}.
        </p>
      ) : null}
    </div>
  );
}
