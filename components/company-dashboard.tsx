import Link from "next/link";
import { prisma } from "@/lib/db";
import { visibleDocumentsWhere, type Viewer } from "@/lib/access";
import { DocumentList, type DocumentListItem } from "./document-items";
import { Icon } from "./icons";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, buttonClass } from "./ui";
import { DOCUMENT_LIST_INCLUDE } from "@/lib/queries";
import { formatDate, pluralize } from "@/lib/utils";

/**
 * What a cast or crew member sees. Deliberately narrow: the shows they are on,
 * the categories their role covers, and what changed recently. No board
 * chrome, no counts of things they cannot open, nothing to get lost in.
 */
export async function CompanyDashboard({
  viewer,
  orgName,
  greeting,
}: {
  viewer: Viewer;
  orgName: string;
  greeting: string;
}) {
  const where = visibleDocumentsWhere(viewer);

  const [categories, productions, recent, counts, total] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: viewer.companyCategoryIds }, archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.production.findMany({
      where: { id: { in: viewer.memberships.map((membership) => membership.productionId) } },
      orderBy: [{ status: "asc" }, { opensOn: "asc" }],
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE" },
      include: DOCUMENT_LIST_INCLUDE,
      orderBy: { lastEditedAt: "desc" },
      take: 10,
    }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { ...where, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.document.count({ where: { ...where, status: "ACTIVE" } }),
  ]);

  const countByCategory = new Map(counts.map((row) => [row.categoryId, row._count._all]));
  const roleNames = [
    ...new Set(viewer.memberships.map((membership) => membership.roleName).filter(Boolean)),
  ];

  if (viewer.memberships.length === 0) {
    return (
      <div>
        <PageHeader title={`Hello, ${greeting}`} />
        <EmptyState icon="theater" title="You are not on a current show">
          Your {orgName} account works, but you have not been added to a production yet — so there
          is nothing here to see. Whoever is running your show can add you.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={roleNames.join(" · ") || undefined}
        title={`Hello, ${greeting}`}
        description={`Everything you need for ${productions
          .map((production) => production.name)
          .join(" and ")}, in one place.`}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {productions.map((production) => {
          const membership = viewer.memberships.find(
            (item) => item.productionId === production.id,
          );
          return (
            <Link
              key={production.id}
              href={`/productions/${production.slug}`}
              className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-900">
                    {production.name}
                  </div>
                  <div className="text-xs text-ink-500">
                    {production.season ?? "Season not set"}
                    {production.venue ? ` · ${production.venue}` : ""}
                  </div>
                </div>
                {membership?.roleName ? <Badge tone="green">{membership.roleName}</Badge> : null}
              </div>
              {membership?.title ? (
                <div className="text-xs text-ink-600">You: {membership.title}</div>
              ) : null}
              {production.opensOn ? (
                <div className="mt-auto flex items-center gap-1 pt-1 text-xs text-ink-500">
                  <Icon name="calendar" className="size-3.5" />
                  Opens {formatDate(production.opensOn)}
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>

      <section>
        <SectionHeader
          icon="grid"
          title="What you can see"
          description={`${total} ${pluralize(total, "document")} shared with the company.`}
        />
        {categories.length === 0 ? (
          <Card className="text-sm text-ink-600">
            Your role does not have any categories attached yet, so nothing is shared with you.
            Whoever runs your show can fix that in the hub.
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => {
              const count = countByCategory.get(category.id) ?? 0;
              return (
                <li key={category.id}>
                  <Link
                    href={`/categories/${category.slug}`}
                    className="card flex h-full items-start gap-3 p-4 transition hover:border-brand-300 hover:shadow-sm"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg"
                      style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                    >
                      <Icon name={category.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900">
                          {category.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-400">{count}</span>
                      </span>
                      {category.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-500">
                          {category.description}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          icon="clock"
          title="Latest"
          action={
            <Link href="/documents" className={buttonClass("ghost")}>
              See all
            </Link>
          }
        />
        <DocumentList
          documents={recent as DocumentListItem[]}
          showPinned={false}
          empty={
            <EmptyState icon="folder" title="Nothing shared with you yet">
              As soon as the schedule or the script is posted, it shows up here.
            </EmptyState>
          }
        />
      </section>

      <p className="text-xs leading-relaxed text-ink-400">
        You are seeing this as a company member: only documents the production team has shared with
        your role. Budgets, casting notes and board paperwork are not visible to you and are not
        listed anywhere on this page.
      </p>
    </div>
  );
}
