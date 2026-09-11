import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import {
  canEditDocument,
  canViewDocument,
  creatableCategoryIds,
  creatableProductionIds,
  getViewerContext,
} from "@/lib/access";
import { DocumentEditForm } from "@/components/forms/document-edit-form";
import { PageHeader } from "@/components/ui";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: { tags: true, shares: { select: { userId: true } } },
  });
  const viewer = await getViewerContext(user);
  if (!document || !canViewDocument(viewer, document)) notFound();
  if (!canEditDocument(viewer, document)) redirect(`/documents/${id}`);

  /**
   * A company member may only re-file a document where they could have filed
   * it in the first place, so the pickers offer exactly that — plus wherever
   * the document already is, so the form can render what it is looking at.
   * The same envelope is enforced again when the form is saved.
   */
  const companyCreatorOnly = !viewer.isBoard;
  const allowedCategoryIds = creatableCategoryIds(viewer);
  const allowedProductionIds = creatableProductionIds(viewer);

  const [config, categories, productions] = await Promise.all([
    getConfig(),
    prisma.category.findMany({
      where: {
        OR: [
          {
            archived: false,
            ...(allowedCategoryIds === null ? {} : { id: { in: allowedCategoryIds } }),
          },
          { id: document.categoryId },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.production.findMany({
      where: {
        OR: [
          {
            status: { not: "ARCHIVED" },
            ...(allowedProductionIds === null ? {} : { id: { in: allowedProductionIds } }),
          },
          ...(document.productionId ? [{ id: document.productionId }] : []),
        ],
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Edit"
        title={document.title}
        description="Changing the category or production also re-files the document in Google Drive."
      />
      <DocumentEditForm
        document={{
          id: document.id,
          title: document.title,
          description: document.description,
          categoryId: document.categoryId,
          productionId: document.productionId,
          visibility: document.visibility,
          editAccess: document.editAccess,
          pinned: document.pinned,
          source: document.source,
          tags: document.tags.map((tag) => tag.name).join(", "),
        }}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          scope: category.scope,
          defaultDocType: category.defaultDocType,
          defaultVisibility: category.defaultVisibility,
          color: category.color,
          icon: category.icon,
          description: category.description,
          companyVisible: category.companyVisible,
          defaultEditAccess: category.defaultEditAccess,
        }))}
        productions={productions.map((production) => ({
          id: production.id,
          name: production.name,
          season: production.season,
          status: production.status,
          abbreviation: production.abbreviation,
        }))}
        groupEmail={config.groupEmail}
        companyCreatorOnly={companyCreatorOnly}
      />
    </div>
  );
}
