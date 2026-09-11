import Link from "next/link";
import { prisma } from "@/lib/db";
import { setCategoryArchivedAction } from "@/app/actions/admin";
import { CategoryForm, FormCard } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Badge, Card, SectionHeader, buttonClass } from "@/components/ui";
import {
  CATEGORY_SCOPE_META,
  DOC_TYPE_META,
  VISIBILITY_META,
  type CategoryScope,
  type Visibility,
} from "@/lib/constants";
import { pluralize } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : undefined;

  const [categories, editing, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    editId ? prisma.category.findUnique({ where: { id: editId } }) : Promise.resolve(null),
    prisma.document.groupBy({ by: ["categoryId"], _count: { _all: true } }),
  ]);
  const countByCategory = new Map(counts.map((row) => [row.categoryId, row._count._all]));

  return (
    <div className="space-y-6">
      <FormCard
        title={editing ? `Edit “${editing.name}”` : "Add a category"}
        description="Categories are the shelves of the hub. Keep them few enough that people can scan the list, and describe clearly what belongs in each."
      >
        <CategoryForm
          key={editing?.id ?? "new"}
          category={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  description: editing.description,
                  icon: editing.icon,
                  color: editing.color,
                  scope: editing.scope,
                  defaultDocType: editing.defaultDocType,
                  defaultVisibility: editing.defaultVisibility,
                  folderName: editing.folderName,
                  sortOrder: editing.sortOrder,
                  companyVisible: editing.companyVisible,
                  keywords: editing.keywords,
                  defaultEditAccess: editing.defaultEditAccess,
                }
              : undefined
          }
        />
      </FormCard>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionHeader icon="grid" title={`${categories.length} categories`} />
        </div>
        <ul className="divide-y divide-ink-100">
          {categories.map((category) => {
            const count = countByCategory.get(category.id) ?? 0;
            const scope = CATEGORY_SCOPE_META[category.scope as CategoryScope];
            const visibility = VISIBILITY_META[category.defaultVisibility as Visibility];
            return (
              <li key={category.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg"
                  style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                >
                  <Icon name={category.icon} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{category.name}</span>
                    <Badge tone="slate">{scope?.label}</Badge>
                    <Badge tone={visibility?.tone ?? "slate"}>{visibility?.label}</Badge>
                    {category.defaultDocType ? (
                      <Badge tone="slate">
                        {DOC_TYPE_META[category.defaultDocType as "DOC"]?.short}
                      </Badge>
                    ) : null}
                    {category.archived ? <Badge tone="slate">Archived</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {count} {pluralize(count, "document")} · order {category.sortOrder} · /
                    {category.slug}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/admin/categories?edit=${category.id}`}
                    className={buttonClass("ghost", "px-2")}
                    aria-label={`Edit ${category.name}`}
                  >
                    <Icon name="pencil" className="size-4" />
                  </Link>
                  <form action={setCategoryArchivedAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <input
                      type="hidden"
                      name="archived"
                      value={category.archived ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={buttonClass("ghost", "px-2")}
                      title={
                        category.archived
                          ? "Bring this category back"
                          : "Hide this category (only works when it has no active documents)"
                      }
                      aria-label={category.archived ? "Restore category" : "Archive category"}
                    >
                      <Icon name={category.archived ? "check" : "archive"} className="size-4" />
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
