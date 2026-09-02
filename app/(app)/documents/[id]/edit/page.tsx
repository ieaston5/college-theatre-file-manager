import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { canEditDocument, canViewDocument } from "@/lib/access";
import { DocumentEditForm } from "@/components/forms/document-edit-form";
import { PageHeader } from "@/components/ui";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: { tags: true, shares: { select: { userId: true } } },
  });
  if (!document || !canViewDocument(user, document)) notFound();
  if (!canEditDocument(user, document)) redirect(`/documents/${id}`);

  const [config, categories, productions] = await Promise.all([
    getConfig(),
    prisma.category.findMany({
      where: { OR: [{ archived: false }, { id: document.categoryId }] },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.production.findMany({
      where: document.productionId
        ? { OR: [{ status: { not: "ARCHIVED" } }, { id: document.productionId }] }
        : { status: { not: "ARCHIVED" } },
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
        }))}
        productions={productions.map((production) => ({
          id: production.id,
          name: production.name,
          season: production.season,
          status: production.status,
          abbreviation: production.abbreviation,
        }))}
        groupEmail={config.groupEmail}
      />
    </div>
  );
}
