import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  canCreateDocuments,
  creatableCategoryIds,
  creatableProductionIds,
  getViewerContext,
} from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSetupState } from "@/lib/config";
import { canvaProvider, canvaReady, getCanvaAccount } from "@/lib/canva";
import { env } from "@/lib/env";
import { DocumentCreateForm } from "@/components/forms/document-create-form";
import { Banner, PageHeader, buttonClass } from "@/components/ui";
import type { SearchParams } from "@/lib/queries";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  if (!canCreateDocuments(viewer)) redirect("/no-access?need=board");
  const companyCreatorOnly = !viewer.isBoard;
  const params = await searchParams;
  const setup = await getSetupState();

  const [categories, productions, templates, canvaConnected, canvaAccount] = await Promise.all([
    prisma.category.findMany({
      where: {
        archived: false,
        ...(creatableCategoryIds(viewer) === null
          ? {}
          : { id: { in: creatableCategoryIds(viewer)! } }),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.production.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ...(creatableProductionIds(viewer) === null
          ? {}
          : { id: { in: creatableProductionIds(viewer)! } }),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.template.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    canvaReady(),
    getCanvaAccount(),
  ]);

  // In simulated mode this is a label, not a network call.
  const canvaAccountLabel =
    env.canvaMode === "mock"
      ? await canvaProvider().accountLabel()
      : (canvaAccount?.displayName ?? null);

  const categorySlug = typeof params.category === "string" ? params.category : undefined;
  const productionSlug = typeof params.production === "string" ? params.production : undefined;

  const notConnected = env.driveMode === "google" && !setup.driveConnected;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="New"
        title="Create a document"
        description="Fill this in once and the hub names the file, files it in the right Drive folder and shares it with the right people."
      />

      {notConnected ? (
        <Banner
          tone="rose"
          icon="warning"
          title="Google Drive is not connected"
          action={
            <Link href="/admin" className={buttonClass("secondary")}>
              Connect
            </Link>
          }
        >
          An admin needs to connect the hub's Google account before documents can be created.
        </Banner>
      ) : null}

      {env.driveMode === "mock" ? (
        <Banner tone="amber" icon="cloud_off" title="Simulated Drive">
          Nothing is written to Google while the hub runs in this mode — you will get a fake file so
          you can see the whole flow. Connect a Google account in Admin to make it real.
        </Banner>
      ) : null}

      {categories.length === 0 ? (
        <Banner tone="amber" icon="warning" title="No categories yet">
          An admin has to create at least one category before documents can be filed.
        </Banner>
      ) : (
        <DocumentCreateForm
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
          templates={templates.map((template) => ({
            id: template.id,
            name: template.name,
            docType: template.docType,
            categoryId: template.categoryId,
            description: template.description,
          }))}
          namingTemplate={setup.config.namingTemplate}
          currentSeason={setup.config.currentSeason}
          groupEmail={setup.config.groupEmail}
          driveMode={env.driveMode}
          companyCreatorOnly={companyCreatorOnly}
          canvaMode={env.canvaMode}
          canvaReady={canvaConnected}
          canvaAccountLabel={canvaAccountLabel}
          defaultCategoryId={categories.find((category) => category.slug === categorySlug)?.id}
          defaultProductionId={
            productions.find((production) => production.slug === productionSlug)?.id
          }
        />
      )}
    </div>
  );
}
