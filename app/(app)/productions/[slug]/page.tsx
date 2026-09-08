import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canCreateDocuments,
  categoryFilterFor,
  getViewerContext,
  visibleProductionIds,
} from "@/lib/access";
import { queryDocuments, type SearchParams } from "@/lib/queries";
import { checklistFor, checklistProgress } from "@/lib/checklist";
import {
  removeChecklistItemAction,
  seedChecklistAction,
  toggleChecklistItemAction,
} from "@/app/actions/rollover";
import { AddChecklistItemForm } from "@/components/forms/access-and-checklist";
import { DocumentFilters } from "@/components/document-filters";
import { DocumentList, type DocumentListItem } from "@/components/document-items";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, Stat, buttonClass } from "@/components/ui";
import { PRODUCTION_STATUS_META, type ProductionStatus } from "@/lib/constants";
import { formatDate, pluralize } from "@/lib/utils";

export default async function ProductionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const { slug } = await params;
  const query = await searchParams;

  const viewer = await getViewerContext(user);
  const production = await prisma.production.findUnique({ where: { slug } });
  if (!production) notFound();

  // Company members only see the shows they are actually on.
  const allowedProductions = visibleProductionIds(viewer);
  if (allowedProductions !== null && !allowedProductions.includes(production.id)) notFound();

  const [{ documents, total }, categories, companyCount, companyByRole, checklist] = await Promise.all([
    queryDocuments(viewer, query, { extra: { productionId: production.id }, take: 200 }),
    prisma.category.findMany({
      where: { ...categoryFilterFor(viewer), scope: { in: ["PRODUCTION", "BOTH"] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.productionMember.count({ where: { productionId: production.id, status: "ACTIVE" } }),
    prisma.productionMember.groupBy({
      by: ["roleId"],
      where: { productionId: production.id, status: "ACTIVE" },
      _count: { _all: true },
    }),
    checklistFor(production.id),
  ]);

  const progress = checklistProgress(checklist);
  const canManage = canCreateDocuments(viewer);

  const roleNames = await prisma.productionRole.findMany({
    where: { id: { in: companyByRole.map((row) => row.roleId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });

  const meta = PRODUCTION_STATUS_META[production.status as ProductionStatus];
  const byCategory = new Map<string, DocumentListItem[]>();
  for (const document of documents as DocumentListItem[]) {
    const list = byCategory.get(document.categoryId) ?? [];
    list.push(document);
    byCategory.set(document.categoryId, list);
  }

  const missing = categories.filter((category) => !byCategory.has(category.id));
  const filtersActive = Boolean(query.q || query.category || query.type || query.visibility || query.mine);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={production.season ?? undefined}
        title={production.name}
        description={production.synopsis ?? undefined}
        action={
          <>
            <Link
              href={`/productions/${production.slug}/company`}
              className={buttonClass("secondary")}
            >
              <Icon name="users" className="size-4" />
              Company{companyCount > 0 ? ` (${companyCount})` : ""}
            </Link>
            {isAdmin(user) ? (
              <Link
                href={`/admin/productions?edit=${production.id}`}
                className={buttonClass("secondary")}
              >
                <Icon name="pencil" className="size-4" />
                Edit show
              </Link>
            ) : null}
            {canCreateDocuments(viewer) ? (
              <Link
                href={`/documents/new?production=${production.slug}`}
                className={buttonClass("primary")}
              >
                <Icon name="plus" className="size-4" />
                New document
              </Link>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {production.abbreviation ? (
          <Badge tone="slate">Files tagged “{production.abbreviation}”</Badge>
        ) : null}
        {production.venue ? (
          <Badge tone="slate" icon="venue">
            {production.venue}
          </Badge>
        ) : null}
        {production.opensOn ? (
          <Badge tone="slate" icon="calendar">
            Opens {formatDate(production.opensOn)}
          </Badge>
        ) : null}
        {production.closesOn ? (
          <Badge tone="slate" icon="calendar">
            Closes {formatDate(production.closesOn)}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Documents" value={total} icon="folder" />
        <Stat label="Categories used" value={byCategory.size} icon="grid" />
        <Stat
          label="Not started"
          value={missing.length}
          icon="alert"
          hint={missing.length > 0 ? "Categories with nothing filed" : "Everything has something"}
        />
        <Stat
          label="Company"
          value={companyCount}
          icon="users"
          href={`/productions/${production.slug}/company`}
          hint={
            roleNames.length > 0
              ? roleNames
                  .map(
                    (role) =>
                      `${
                        companyByRole.find((row) => row.roleId === role.id)?._count._all ?? 0
                      } ${role.name.toLowerCase()}`,
                  )
                  .join(" · ")
              : "Nobody added yet"
          }
        />
      </div>

      <DocumentFilters
        categories={categories.map((category) => ({
          value: category.slug,
          label: category.name,
        }))}
        productions={[]}
        lockedProduction={production.slug}
      />

      {documents.length === 0 ? (
        <EmptyState
          icon="theater"
          title={filtersActive ? "Nothing matches those filters" : `Nothing filed for ${production.name} yet`}
          action={
            canCreateDocuments(viewer) ? (
              <Link
                href={`/documents/new?production=${production.slug}`}
                className={buttonClass("primary")}
              >
                <Icon name="plus" className="size-4" />
                Create the first document
              </Link>
            ) : null
          }
        >
          Budgets, rehearsal reports, contact sheets — anything filed against this show lands here.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {categories
            .filter((category) => byCategory.has(category.id))
            .map((category) => (
              <section key={category.id}>
                <SectionHeader
                  icon={category.icon}
                  title={
                    <Link href={`/categories/${category.slug}`} className="hover:underline">
                      {category.name}
                    </Link>
                  }
                  description={`${byCategory.get(category.id)!.length} ${pluralize(
                    byCategory.get(category.id)!.length,
                    "document",
                  )}`}
                  action={
                    canCreateDocuments(viewer) ? (
                      <Link
                        href={`/documents/new?category=${category.slug}&production=${production.slug}`}
                        className={buttonClass("ghost")}
                      >
                        <Icon name="plus" className="size-3.5" />
                        Add
                      </Link>
                    ) : null
                  }
                />
                <DocumentList
                  documents={byCategory.get(category.id)!}
                  showCategory={false}
                  showProduction={false}
                />
              </section>
            ))}
        </div>
      )}

      {checklist.length > 0 ? (
        <Card>
          <SectionHeader
            icon="clipboard"
            title="Checklist"
            description={`${progress.complete} of ${progress.total} done. Items tied to a category tick themselves as soon as something is filed there.`}
            action={
              canManage ? (
                <AddChecklistItemForm
                  productionId={production.id}
                  categories={categories.map((category) => ({
                    id: category.id,
                    name: category.name,
                  }))}
                />
              ) : null
            }
          />

          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className={
                progress.percent === 100
                  ? "h-full rounded-full bg-emerald-500 transition-all"
                  : "h-full rounded-full bg-brand-500 transition-all"
              }
              style={{ width: `${Math.max(progress.percent, 2)}%` }}
            />
          </div>

          <ul className="divide-y divide-ink-100">
            {checklist.map((item) => {
              const complete = item.done || item.autoDone;
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2.5 py-2">
                  {canManage && !item.autoDone ? (
                    <form action={toggleChecklistItemAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className={
                          complete
                            ? "grid size-5 place-items-center rounded border-2 border-emerald-500 bg-emerald-500 text-white"
                            : "grid size-5 place-items-center rounded border-2 border-ink-300 text-transparent hover:border-brand-400"
                        }
                        aria-label={complete ? `Untick ${item.label}` : `Tick ${item.label}`}
                      >
                        <Icon name="check" className="size-3" />
                      </button>
                    </form>
                  ) : (
                    <span
                      className={
                        complete
                          ? "grid size-5 place-items-center rounded border-2 border-emerald-500 bg-emerald-500 text-white"
                          : "grid size-5 place-items-center rounded border-2 border-ink-200 text-transparent"
                      }
                      title={item.autoDone ? "Ticked itself — something is filed" : undefined}
                    >
                      <Icon name="check" className="size-3" />
                    </span>
                  )}

                  <span className="min-w-40 flex-1">
                    <span
                      className={
                        complete
                          ? "block text-sm text-ink-500 line-through"
                          : "block text-sm text-ink-900"
                      }
                    >
                      {item.label}
                    </span>
                    {item.hint ? (
                      <span className="block text-xs text-ink-400">{item.hint}</span>
                    ) : null}
                  </span>

                  {item.categorySlug ? (
                    item.autoDone ? (
                      <Link
                        href={`/categories/${item.categorySlug}?production=${production.slug}`}
                        className="shrink-0 text-xs text-emerald-700 hover:underline"
                      >
                        {item.documentCount} filed
                      </Link>
                    ) : canCreateDocuments(viewer) ? (
                      <Link
                        href={`/documents/new?category=${item.categorySlug}&production=${production.slug}`}
                        className="shrink-0 rounded-lg border border-dashed border-ink-300 px-2 py-1 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-700"
                      >
                        File one
                      </Link>
                    ) : null
                  ) : null}

                  {canManage ? (
                    <form action={removeChecklistItemAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className="shrink-0 rounded p-1 text-ink-300 hover:bg-ink-100 hover:text-rose-600"
                        aria-label={`Remove ${item.label}`}
                      >
                        <Icon name="x" className="size-3.5" />
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : canManage ? (
        <Card>
          <SectionHeader
            icon="clipboard"
            title="No checklist yet"
            description="The standard list of what a show needs, with the document-shaped items ticking themselves as you file."
          />
          <form action={seedChecklistAction}>
            <input type="hidden" name="productionId" value={production.id} />
            <button type="submit" className={buttonClass("secondary")}>
              <Icon name="clipboard" className="size-4" />
              Add the standard checklist
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
