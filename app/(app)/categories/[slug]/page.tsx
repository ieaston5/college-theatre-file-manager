import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canCreateDocuments,
  getViewerContext,
  productionFilterFor,
  visibleCategoryIds,
} from "@/lib/access";
import { queryDocuments, type SearchParams } from "@/lib/queries";
import { DocumentFilters } from "@/components/document-filters";
import { DocumentList, type DocumentListItem } from "@/components/document-items";
import { Icon } from "@/components/icons";
import { Badge, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { CATEGORY_SCOPE_META, DOC_TYPE_META, type CategoryScope } from "@/lib/constants";
import { pluralize } from "@/lib/utils";

export default async function CategoryPage({
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
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) notFound();

  // Company members can only reach the categories their role covers.
  const allowed = visibleCategoryIds(viewer);
  if (allowed !== null && !allowed.includes(category.id)) notFound();

  const [{ documents, total }, productions] = await Promise.all([
    queryDocuments(viewer, query, { extra: { categoryId: category.id }, take: 100 }),
    prisma.production.findMany({
      where: productionFilterFor(viewer),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { name: true, slug: true },
    }),
  ]);

  const scope = CATEGORY_SCOPE_META[category.scope as CategoryScope];

  return (
    <div>
      <PageHeader
        eyebrow={viewer.isBoard ? scope?.label : undefined}
        title={
          <span className="flex items-center gap-2.5">
            <span
              className="grid size-8 place-items-center rounded-lg"
              style={{ backgroundColor: `${category.color}1a`, color: category.color }}
            >
              <Icon name={category.icon} className="size-4" />
            </span>
            {category.name}
          </span>
        }
        description={category.description ?? (viewer.isBoard ? scope?.blurb : undefined)}
        action={
          canCreateDocuments(viewer) ? (
            <Link
              href={`/documents/new?category=${category.slug}`}
              className={buttonClass("primary")}
            >
              <Icon name="plus" className="size-4" />
              New in {category.name}
            </Link>
          ) : null
        }
      />

      {/* Everything except the count describes how the category behaves when
          you file into it — noise for somebody who is only reading. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <Badge tone="slate">
          {total} {pluralize(total, "document")}
        </Badge>
        {viewer.isBoard ? (
          <>
            {category.defaultDocType ? (
              <Badge tone="slate" icon={DOC_TYPE_META[category.defaultDocType as "DOC"]?.icon}>
                Usually a {DOC_TYPE_META[category.defaultDocType as "DOC"]?.label}
              </Badge>
            ) : null}
            <Badge tone={category.defaultVisibility === "PRIVATE" ? "amber" : "indigo"}>
              Defaults to {category.defaultVisibility === "PRIVATE" ? "private" : "board"}
            </Badge>
            <span>Drive folder: {category.folderName ?? category.name}</span>
          </>
        ) : null}
      </div>

      <DocumentFilters
        categories={[]}
        productions={productions.map((production) => ({
          value: production.slug,
          label: production.name,
        }))}
        lockedCategory={category.slug}
        boardVisibility={viewer.isBoard}
      />

      <DocumentList
        documents={documents as DocumentListItem[]}
        showCategory={false}
        showPinned={viewer.isBoard}
        empty={
          <EmptyState
            icon={category.icon}
            title={`Nothing filed under ${category.name} yet`}
            action={
              canCreateDocuments(viewer) ? (
                <Link
                  href={`/documents/new?category=${category.slug}`}
                  className={buttonClass("primary")}
                >
                  <Icon name="plus" className="size-4" />
                  Create the first one
                </Link>
              ) : null
            }
          >
            {category.description ??
              (viewer.isBoard
                ? "Anything created in this category shows up here for the whole board."
                : "Anything shared with you in this category shows up here.")}
          </EmptyState>
        }
      />
    </div>
  );
}
