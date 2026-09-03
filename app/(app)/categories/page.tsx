import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { categoryFilterFor, getViewerContext, visibleDocumentsWhere } from "@/lib/access";
import { Icon } from "@/components/icons";
import { Badge, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { CATEGORY_SCOPE_META, type CategoryScope } from "@/lib/constants";
import { pluralize, relativeTime } from "@/lib/utils";

export default async function CategoriesPage() {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  const where = visibleDocumentsWhere(viewer);

  const [categories, counts, latest] = await Promise.all([
    prisma.category.findMany({
      where: categoryFilterFor(viewer),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { ...where, status: "ACTIVE" },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      distinct: ["categoryId"],
      select: { categoryId: true, title: true, id: true },
    }),
  ]);

  const stats = new Map(
    counts.map((row) => [row.categoryId, { count: row._count._all, updated: row._max.updatedAt }]),
  );
  const newest = new Map(latest.map((row) => [row.categoryId, row]));

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Every kind of information the board keeps, and where it lives."
        action={
          isAdmin(user) ? (
            <Link href="/admin/categories" className={buttonClass("secondary")}>
              <Icon name="settings" className="size-4" />
              Edit categories
            </Link>
          ) : null
        }
      />

      {categories.length === 0 ? (
        <EmptyState icon="grid" title="No categories yet">
          An admin sets these up in Admin → Categories.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {categories.map((category) => {
            const stat = stats.get(category.id);
            const recent = newest.get(category.id);
            const scope = CATEGORY_SCOPE_META[category.scope as CategoryScope];
            return (
              <li key={category.id}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="card flex h-full gap-3 p-4 transition hover:border-brand-300 hover:shadow-sm"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg"
                    style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                  >
                    <Icon name={category.icon} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink-900">{category.name}</span>
                      <Badge tone="slate">{scope?.label ?? category.scope}</Badge>
                    </span>
                    {category.description ? (
                      <span className="mt-1 block text-xs leading-relaxed text-ink-500">
                        {category.description}
                      </span>
                    ) : null}
                    <span className="mt-2 block text-xs text-ink-500">
                      {stat?.count ?? 0} {pluralize(stat?.count ?? 0, "document")}
                      {stat?.updated ? ` · last touched ${relativeTime(stat.updated)}` : ""}
                    </span>
                    {recent ? (
                      <span className="mt-1 block truncate text-xs text-ink-400">
                        Latest: {recent.title}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
