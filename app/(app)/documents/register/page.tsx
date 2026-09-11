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
import { env } from "@/lib/env";
import { DocumentRegisterForm } from "@/components/forms/document-register-form";
import { Banner, PageHeader } from "@/components/ui";

export default async function RegisterDocumentPage() {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  if (!canCreateDocuments(viewer)) redirect("/no-access?need=board");
  const companyCreatorOnly = !viewer.isBoard;
  const setup = await getSetupState();

  const [categories, productions] = await Promise.all([
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
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Add existing"
        title="Put something that already exists on the hub"
        description="For the spreadsheets and docs that are already floating around Drive, plus anything that lives elsewhere — a website, a form, a Dropbox folder."
      />

      <Banner tone="sky" icon="info" title="What this does and does not do">
        The hub records where the file lives and what it is for, so people can find it. It does not
        take ownership of it. If you want it owned by the club long term, create a fresh document
        here and copy the contents across.
      </Banner>

      <DocumentRegisterForm
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
        boardCount={setup.boardCount}
        namingTemplate={setup.config.namingTemplate}
        currentSeason={setup.config.currentSeason}
        hubAccountEmail={setup.account?.email ?? null}
        driveMode={env.driveMode}
        companyCreatorOnly={companyCreatorOnly}
      />
    </div>
  );
}
