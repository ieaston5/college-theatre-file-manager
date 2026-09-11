import Link from "next/link";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { setProductionStatusAction } from "@/app/actions/admin";
import { FormCard, ProductionForm } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Badge, Card, SectionHeader, buttonClass } from "@/components/ui";
import { PRODUCTION_STATUSES, PRODUCTION_STATUS_META, type ProductionStatus } from "@/lib/constants";
import { formatDate, pluralize } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export default async function AdminProductionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : undefined;

  const [config, productions, editing, counts] = await Promise.all([
    getConfig(),
    prisma.production.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    editId ? prisma.production.findUnique({ where: { id: editId } }) : Promise.resolve(null),
    prisma.document.groupBy({ by: ["productionId"], _count: { _all: true } }),
  ]);
  const countByProduction = new Map(counts.map((row) => [row.productionId ?? "", row._count._all]));

  return (
    <div className="space-y-6">
      <FormCard
        title={editing ? `Edit “${editing.name}”` : "Add a production"}
        description="Each show gets its own folder in Drive, created the first time something is filed against it."
      >
        <ProductionForm
          key={editing?.id ?? "new"}
          production={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  abbreviation: editing.abbreviation,
                  season: editing.season,
                  status: editing.status,
                  venue: editing.venue,
                  synopsis: editing.synopsis,
                  opensOn: isoDate(editing.opensOn),
                  closesOn: isoDate(editing.closesOn),
                  color: editing.color,
                }
              : undefined
          }
          currentSeason={config.currentSeason}
        />
      </FormCard>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionHeader icon="theater" title={`${productions.length} productions`} />
        </div>
        <ul className="divide-y divide-ink-100">
          {productions.map((production) => {
            const meta = PRODUCTION_STATUS_META[production.status as ProductionStatus];
            const count = countByProduction.get(production.id) ?? 0;
            return (
              <li key={production.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/productions/${production.slug}`}
                      className="text-sm font-medium text-ink-900 hover:text-brand-700"
                    >
                      {production.name}
                    </Link>
                    <Badge tone={meta?.tone ?? "slate"}>{meta?.label}</Badge>
                    {production.abbreviation ? (
                      <Badge tone="slate">{production.abbreviation}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {production.season ?? "No season"} · {count} {pluralize(count, "document")}
                    {production.opensOn ? ` · opens ${formatDate(production.opensOn)}` : ""}
                    {production.driveFolderId ? " · Drive folder ready" : " · no Drive folder yet"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={setProductionStatusAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={production.id} />
                    <select
                      name="status"
                      defaultValue={production.status}
                      className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs"
                      aria-label={`Status for ${production.name}`}
                    >
                      {PRODUCTION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {PRODUCTION_STATUS_META[status].label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={buttonClass("ghost", "px-2")} title="Apply">
                      <Icon name="check" className="size-4" />
                    </button>
                  </form>
                  {production.driveFolderId ? (
                    <a
                      href={
                        env.driveMode === "mock"
                          ? `/mock-drive/${production.driveFolderId}`
                          : `https://drive.google.com/drive/folders/${production.driveFolderId}`
                      }
                      target={env.driveMode === "mock" ? undefined : "_blank"}
                      rel="noreferrer"
                      className={buttonClass("ghost", "px-2")}
                      title="Open the show's Drive folder"
                    >
                      <Icon name="folder-open" className="size-4" />
                    </a>
                  ) : null}
                  <Link
                    href={`/admin/productions?edit=${production.id}`}
                    className={buttonClass("ghost", "px-2")}
                    aria-label={`Edit ${production.name}`}
                  >
                    <Icon name="pencil" className="size-4" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
