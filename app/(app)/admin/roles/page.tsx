import Link from "next/link";
import { prisma } from "@/lib/db";
import { setRoleArchivedAction } from "@/app/actions/company";
import { FormCard } from "@/components/forms/admin-forms";
import { ProductionRoleForm } from "@/components/forms/company-forms";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, SectionHeader, buttonClass } from "@/components/ui";
import { pluralize } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : undefined;

  const [roles, companyCategories, editing, boardOnlyCount] = await Promise.all([
    prisma.productionRole.findMany({
      orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.category.findMany({
      where: { archived: false, companyVisible: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, icon: true, color: true },
    }),
    editId
      ? prisma.productionRole.findUnique({
          where: { id: editId },
          include: { categories: { select: { id: true } } },
        })
      : Promise.resolve(null),
    prisma.category.count({ where: { archived: false, companyVisible: false } }),
  ]);

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="Two layers, on purpose">
        A category is either open to production companies or it is not — that is set per category in{" "}
        <Link href="/admin/categories" className="font-medium underline">
          Categories
        </Link>{" "}
        ({boardOnlyCount} {pluralize(boardOnlyCount, "category", "categories")} are board-only right
        now, including budgets and casting). Within the open ones, a role decides what that
        particular job needs. Then each document still has its own “who can see it” — so a role
        grants access to a shelf, not to everything on it.
      </Banner>

      <FormCard
        title={editing ? `Edit “${editing.name}”` : "Add a production role"}
        description="Cast, crew, design, music — whatever your processes actually look like."
      >
        <ProductionRoleForm
          role={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  description: editing.description,
                  sortOrder: editing.sortOrder,
                  isDefault: editing.isDefault,
                  canCreate: editing.canCreate,
                  categoryIds: editing.categories.map((category) => category.id),
                }
              : undefined
          }
          categories={companyCategories}
        />
      </FormCard>

      {roles.length === 0 ? (
        <EmptyState icon="user-cog" title="No production roles yet">
          Add at least one before adding people to a show.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionHeader icon="user-cog" title={`${roles.length} roles`} />
          </div>
          <ul className="divide-y divide-ink-100">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{role.name}</span>
                    {role.isDefault ? <Badge tone="violet">Default</Badge> : null}
                    <Badge tone={role.canCreate ? "green" : "slate"}>
                      {role.canCreate ? "can add documents" : "view only"}
                    </Badge>
                    {role.archived ? <Badge tone="slate">Archived</Badge> : null}
                    <Badge tone="slate">
                      {role._count.members} {pluralize(role._count.members, "person", "people")}
                    </Badge>
                  </div>
                  {role.description ? (
                    <p className="mt-0.5 text-xs text-ink-500">{role.description}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {role.categories.length === 0 ? (
                      <span className="text-xs text-rose-700">
                        No categories — people on this role see nothing.
                      </span>
                    ) : (
                      role.categories.map((category) => (
                        <span
                          key={category.id}
                          className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600"
                        >
                          {category.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/admin/roles?edit=${role.id}`}
                    className={buttonClass("ghost", "px-2")}
                    aria-label={`Edit ${role.name}`}
                  >
                    <Icon name="pencil" className="size-4" />
                  </Link>
                  <form action={setRoleArchivedAction}>
                    <input type="hidden" name="id" value={role.id} />
                    <input type="hidden" name="archived" value={role.archived ? "false" : "true"} />
                    <button
                      type="submit"
                      className={buttonClass("ghost", "px-2")}
                      aria-label={role.archived ? `Restore ${role.name}` : `Archive ${role.name}`}
                      title={
                        role.archived
                          ? "Bring this role back"
                          : "Archive (only works when nobody is on it)"
                      }
                    >
                      <Icon name={role.archived ? "check" : "archive"} className="size-4" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
