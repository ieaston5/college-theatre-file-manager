import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canCreateDocuments, getViewerContext, productionFilterFor } from "@/lib/access";
import { visibleCategories } from "@/lib/nav";
import { queryDocuments, type SearchParams } from "@/lib/queries";
import { DocumentFilters, Filtered, FilteringProvider } from "@/components/document-filters";
import {
  DocumentResults,
  DocumentResultsSkeleton,
  DocumentTotalNote,
  DocumentTotalSentence,
  filterKey,
} from "@/components/document-results";
import { SearchField } from "@/components/search-field";
import { Icon } from "@/components/icons";
import { Banner, EmptyState, PageHeader, buttonClass } from "@/components/ui";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  const params = await searchParams;
  const term = typeof params.q === "string" ? params.q : undefined;

  // Started here and awaited inside the boundary below, so the heading and the
  // filters are on screen while the list is still being fetched.
  const documents = queryDocuments(viewer, params, { take: 100 });

  const [categories, productions] = await Promise.all([
    visibleCategories(viewer),
    prisma.production.findMany({
      where: productionFilterFor(viewer),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { name: true, slug: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title={term ? `Results for “${term}”` : "All documents"}
        description={
          <Suspense fallback="Counting…">
            <DocumentTotalSentence query={documents} />
          </Suspense>
        }
        action={
          canCreateDocuments(viewer) ? (
            <Link href="/documents/new" className={buttonClass("primary")}>
              <Icon name="plus" className="size-4" />
              New document
            </Link>
          ) : null
        }
      />

      <div className="mb-4 lg:hidden">
        <SearchField />
      </div>

      {params.removed === "1" ? (
        <Banner tone="slate" icon="check">
          That document was removed from the hub.
        </Banner>
      ) : null}

      <FilteringProvider>
        <DocumentFilters
          categories={categories.map((category) => ({
            value: category.slug,
            label: category.name,
          }))}
          productions={productions.map((production) => ({
            value: production.slug,
            label: production.name,
          }))}
          boardVisibility={viewer.isBoard}
        />

        {/* The boundary lets the frame go out ahead of the query on the first
            render; Filtered fades the rows already on screen while a filter
            change is in flight, which React otherwise leaves looking current. */}
        <Filtered>
          <Suspense key={filterKey(params)} fallback={<DocumentResultsSkeleton rows={8} />}>
            <DocumentResults
              query={documents}
              showPinned={viewer.isBoard}
              empty={
                <EmptyState
                  icon="search"
                  title={term ? "Nothing matched that" : "No documents match these filters"}
                  action={
                    <Link href="/documents" className={buttonClass("secondary")}>
                      Clear filters
                    </Link>
                  }
                >
                  {term
                    ? "Try a shorter search, or check whether it was filed as private by someone else."
                    : "Loosen a filter, or create the document you were looking for."}
                </EmptyState>
              }
            />
            <DocumentTotalNote query={documents} />
          </Suspense>
        </Filtered>
      </FilteringProvider>
    </div>
  );
}
