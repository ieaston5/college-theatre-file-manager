import { Suspense } from "react";
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
import { DocumentFilters, Filtered, FilteringProvider } from "@/components/document-filters";
import {
  DocumentResults,
  DocumentResultsSkeleton,
  DocumentTotal,
  filterKey,
} from "@/components/document-results";
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

  // Started, not awaited: the page frame and the filter bar go out while this
  // is still in flight, and the list streams in behind its own boundary.
  const documents = queryDocuments(viewer, query, {
    extra: { categoryId: category.id },
    take: 100,
  });

  const productions = await prisma.production.findMany({
    where: productionFilterFor(viewer),
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: { name: true, slug: true },
  });

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

      <FilteringProvider>
        {/* Everything except the count describes how the category behaves when
            you file into it — noise for somebody who is only reading. */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Filtered>
            <Suspense fallback={<Badge tone="slate">counting…</Badge>}>
              <DocumentTotal query={documents} />
            </Suspense>
          </Filtered>
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

        {/* The boundary is for the first render of the page, where it lets the
            frame go out ahead of the query. A filter change afterwards keeps
            the previous rows on screen — React's transition semantics, and the
            right call, since nothing jumps — so Filtered fades them instead
            while the new ones are on the way. */}
        <Filtered>
          <Suspense key={filterKey(query)} fallback={<DocumentResultsSkeleton />}>
            <DocumentResults
              query={documents}
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
          </Suspense>
        </Filtered>
      </FilteringProvider>
    </div>
  );
}
