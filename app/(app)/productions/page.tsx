import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleDocumentsWhere } from "@/lib/access";
import { Icon } from "@/components/icons";
import { Badge, EmptyState, PageHeader, SectionHeader, buttonClass } from "@/components/ui";
import { PRODUCTION_STATUS_META, type ProductionStatus } from "@/lib/constants";
import { formatDate, pluralize } from "@/lib/utils";

const GROUPS: Array<{ status: ProductionStatus; title: string; description: string }> = [
  { status: "ACTIVE", title: "In production", description: "Rehearsing or running right now." },
  { status: "PLANNING", title: "In planning", description: "Announced, paperwork starting." },
  { status: "CLOSED", title: "Closed", description: "Finished, still being wrapped up." },
  { status: "ARCHIVED", title: "Archive", description: "Past seasons, kept for reference." },
];

export default async function ProductionsPage() {
  const user = await requireUser();
  const where = visibleDocumentsWhere(user);

  const [productions, counts] = await Promise.all([
    prisma.production.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
    prisma.document.groupBy({
      by: ["productionId"],
      where: { ...where, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ]);

  const countByProduction = new Map(
    counts.map((row) => [row.productionId ?? "", row._count._all]),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Productions"
        description="Every show, with the paperwork attached to it."
        action={
          isAdmin(user) ? (
            <Link href="/admin/productions" className={buttonClass("secondary")}>
              <Icon name="settings" className="size-4" />
              Manage productions
            </Link>
          ) : null
        }
      />

      {productions.length === 0 ? (
        <EmptyState
          icon="theater"
          title="No productions yet"
          action={
            isAdmin(user) ? (
              <Link href="/admin/productions" className={buttonClass("primary")}>
                <Icon name="plus" className="size-4" />
                Add a production
              </Link>
            ) : null
          }
        >
          Add the shows you are working on and documents can be attached to them.
        </EmptyState>
      ) : (
        GROUPS.map((group) => {
          const shows = productions.filter((production) => production.status === group.status);
          if (shows.length === 0) return null;
          const meta = PRODUCTION_STATUS_META[group.status];
          return (
            <section key={group.status}>
              <SectionHeader
                icon={group.status === "ACTIVE" ? "star" : "theater"}
                title={group.title}
                description={group.description}
              />
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shows.map((production) => {
                  const count = countByProduction.get(production.id) ?? 0;
                  return (
                    <li key={production.id}>
                      <Link
                        href={`/productions/${production.slug}`}
                        className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand-300 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink-900">
                              {production.name}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {production.season ?? "Season not set"}
                            </span>
                          </span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                        {production.synopsis ? (
                          <p className="line-clamp-2 text-xs leading-relaxed text-ink-500">
                            {production.synopsis}
                          </p>
                        ) : null}
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1 text-xs text-ink-500">
                          <span className="inline-flex items-center gap-1">
                            <Icon name="folder" className="size-3.5" />
                            {count} {pluralize(count, "document")}
                          </span>
                          {production.opensOn ? (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="calendar" className="size-3.5" />
                              {formatDate(production.opensOn)}
                            </span>
                          ) : null}
                          {production.venue ? (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Icon name="venue" className="size-3.5" />
                              {production.venue}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
