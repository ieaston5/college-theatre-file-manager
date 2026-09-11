import Link from "next/link";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetupState } from "@/lib/config";
import { driveProvider } from "@/lib/google";
import { ownershipHandoverList, cleanTitle } from "@/lib/import";
import {
  createSampleMessAction,
  deleteBatchAction,
  startScanAction,
  unskipItemAction,
} from "@/app/actions/import";
import { ImportScanForm } from "@/components/forms/import-scan-form";
import { ImportTriage } from "@/components/forms/import-triage";
import { HandoverList } from "@/components/forms/handover-list";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, SectionHeader, Stat, buttonClass } from "@/components/ui";
import { formatDateTime, pluralize, relativeTime } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

/**
 * Bringing the existing pile onto the hub. This is the screen that decides
 * whether the project works: the club's information already exists in
 * spreadsheets across several Drives, and if it never arrives here, people
 * carry on going to Drive directly.
 */
export default async function AdminImportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const setup = await getSetupState();
  const activeBatchId = typeof params.batch === "string" ? params.batch : undefined;

  const [batches, categories, productions] = await Promise.all([
    prisma.importBatch.findMany({
      orderBy: { scannedAt: "desc" },
      take: 10,
      include: {
        startedBy: { select: { name: true, email: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.category.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        scope: true,
        companyVisible: true,
        defaultVisibility: true,
        keywords: true,
      },
    }),
    prisma.production.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { id: true, name: true },
    }),
  ]);

  const batch =
    (activeBatchId ? batches.find((entry) => entry.id === activeBatchId) : batches[0]) ?? null;

  const [pending, done, handover, hubAccountEmail] = await Promise.all([
    batch
      ? prisma.importItem.findMany({
          where: { batchId: batch.id, decision: "PENDING" },
          orderBy: [{ confidence: "desc" }, { name: "asc" }],
          take: 150,
        })
      : Promise.resolve([]),
    batch
      ? prisma.importItem.groupBy({
          by: ["decision"],
          where: { batchId: batch.id },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    ownershipHandoverList(setup.account?.email ?? null),
    Promise.resolve(setup.account?.email ?? null),
  ]);

  const counts = Object.fromEntries(done.map((row) => [row.decision, row._count._all])) as Record<
    string,
    number
  >;
  const skipped = batch
    ? await prisma.importItem.findMany({
        where: { batchId: batch.id, decision: "SKIPPED" },
        orderBy: { name: "asc" },
        take: 40,
      })
    : [];

  const uncategorised = categories.filter((category) => !category.keywords).length;

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="How importing works">
        The hub reads a Drive folder, guesses where each file belongs from its name and the folder
        it sits in, and lets you confirm a screenful at a time. Filing a file records where it
        belongs and shares it to match — it does not move the file or change who owns it. Ownership
        transfer is the one thing the hub cannot do for you; there is a chase-list at the bottom.
      </Banner>

      <Card>
        <SectionHeader
          icon="folder-open"
          title="Scan a folder"
          description="Point it at last year's shared folder, or one person's show folder."
        />
        <ImportScanForm
          hubAccountEmail={hubAccountEmail}
          driveMode={env.driveMode}
          rootFolderId={setup.account?.rootFolderId ?? null}
        />

        {env.driveMode === "mock" ? (
          <form action={createSampleMessAction} className="mt-4 border-t border-ink-100 pt-4">
            <p className="mb-2 text-xs leading-relaxed text-ink-500">
              Running on the simulated Drive, so there is nothing real to scan. This creates a
              folder of realistically messy files — inconsistent names, several owners, a couple of
              shows — to try the flow on.
            </p>
            <button type="submit" className={buttonClass("secondary")}>
              <Icon name="sparkles" className="size-4" />
              Create a sample mess to import
            </button>
          </form>
        ) : null}

        {uncategorised > 0 ? (
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            {uncategorised} of your {categories.length} categories have no keywords set, so the hub
            can only guess them from their name.{" "}
            <Link href="/admin/categories" className="font-medium text-brand-700 hover:underline">
              Adding a few words each
            </Link>{" "}
            (“budget, receipts, reimbursement”) makes the guessing noticeably better.
          </p>
        ) : null}
      </Card>

      {batches.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">Scans</span>
          {batches.map((entry) => (
            <Link
              key={entry.id}
              href={`/admin/import?batch=${entry.id}`}
              className={
                entry.id === batch?.id
                  ? "rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                  : "rounded-lg px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-100"
              }
            >
              {entry.sourceFolderName ?? "Folder"} · {entry._count.items}
            </Link>
          ))}
        </div>
      ) : null}

      {!batch ? (
        <EmptyState icon="folder" title="No scans yet">
          Scan a folder above to see what is in it.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Found" value={batch.fileCount} icon="folder" />
            <Stat label="Left to triage" value={counts.PENDING ?? 0} icon="clipboard" />
            <Stat label="Filed" value={counts.FILED ?? 0} icon="check-circle" />
            <Stat
              label="Already on the hub"
              value={counts.DUPLICATE ?? 0}
              icon="copy"
              hint="Skipped automatically"
            />
          </div>

          <Card>
            <SectionHeader
              icon="clipboard"
              title={`${batch.sourceFolderName ?? "Folder"} — ${counts.PENDING ?? 0} to go`}
              description={`Scanned ${relativeTime(batch.scannedAt)} by ${
                batch.startedBy?.name ?? batch.startedBy?.email ?? "someone"
              }.`}
              action={
                <form action={deleteBatchAction}>
                  <input type="hidden" name="id" value={batch.id} />
                  <button type="submit" className={buttonClass("ghost")}>
                    <Icon name="trash" className="size-4" />
                    Discard this scan
                  </button>
                </form>
              }
            />
            <ImportTriage
              items={pending.map((item) => ({
                id: item.id,
                name: item.name,
                mimeType: item.mimeType,
                ownerEmail: item.ownerEmail,
                folderPath: item.folderPath,
                // Narrowed for the client component: a byte count is only
                // ever displayed, and Number is exact well past any file size.
                sizeBytes: item.sizeBytes === null ? null : Number(item.sizeBytes),
                modifiedAt: item.modifiedAt?.toISOString() ?? null,
                webViewLink: item.webViewLink,
                guessedCategoryId: item.guessedCategoryId,
                guessedProductionId: item.guessedProductionId,
                confidence: item.confidence,
                suggestedTitle: cleanTitle(item.name),
              }))}
              categories={categories}
              productions={productions}
              hubAccountEmail={hubAccountEmail}
            />
          </Card>

          {skipped.length > 0 ? (
            <Card>
              <SectionHeader
                icon="archive"
                title={`${skipped.length} skipped`}
                description="Not filed, and not offered again. Put one back if you change your mind."
              />
              <ul className="flex flex-wrap gap-1.5">
                {skipped.map((item) => (
                  <li key={item.id}>
                    <form action={unskipItemAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-200"
                        title="Put this back in the list"
                      >
                        <Icon name="refresh" className="size-3" />
                        {item.name}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}

      <Card className={handover.length > 0 ? "border-amber-200" : undefined}>
        <SectionHeader
          icon="user-cog"
          title="Ownership to chase"
          description="Files the hub tracks that somebody else still owns. Google only lets the current owner transfer a file, so this is a list to send — not something the hub can do."
        />
        {handover.length === 0 ? (
          <p className="text-sm text-ink-600">
            {hubAccountEmail
              ? `Everything the hub tracks is already owned by ${hubAccountEmail}. Nothing to chase.`
              : "Connect the hub's Google account to see which files are owned by individuals."}
          </p>
        ) : (
          <HandoverList
            owners={handover.map((entry) => ({
              owner: entry.owner,
              files: entry.files.map((file) => ({ id: file.id, title: file.title })),
            }))}
            hubAccountEmail={hubAccountEmail}
          />
        )}
      </Card>

      {params.sample === "1" ? (
        <Banner tone="green" icon="check">
          Sample files created. Scan “Old Penn Players Drive (sample mess)” above — its folder link
          is in the picker.
        </Banner>
      ) : null}

      <p className="text-xs text-ink-400">
        A scan reads up to 400 files and four folder levels deep. Run it again per folder if the
        pile is bigger than that. Last scan{" "}
        {batches[0] ? formatDateTime(batches[0].scannedAt) : "never"}.
      </p>
    </div>
  );
}
