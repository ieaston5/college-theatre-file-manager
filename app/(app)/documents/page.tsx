import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canCreateDocuments, getViewerContext, productionFilterFor } from "@/lib/access";
import { visibleCategories } from "@/lib/nav";
import { queryDocuments, type SearchParams } from "@/lib/queries";
import { DocumentFilters } from "@/components/document-filters";
import { DocumentList, type DocumentListItem } from "@/components/document-items";
import { SearchField } from "@/components/search-field";
import { Icon } from "@/components/icons";
import { Banner, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { pluralize } from "@/lib/utils";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  const params = await searchParams;
  const term = typeof params.q === "string" ? params.q : undefined;

  const [{ documents, total }, categories, productions] = await Promise.all([
    queryDocuments(viewer, params, { take: 100 }),
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
        description={`${total} ${pluralize(total, "document")} you can see.`}
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

      <DocumentFilters
        categories={categories.map((category) => ({ value: category.slug, label: category.name }))}
        productions={productions.map((production) => ({
          value: production.slug,
          label: production.name,
        }))}
      />

      <DocumentList
        documents={documents as DocumentListItem[]}
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

      {total > documents.length ? (
        <p className="mt-4 text-center text-xs text-ink-400">
          Showing the first {documents.length} of {total}. Narrow the filters to see the rest.
        </p>
      ) : null}
    </div>
  );
}
