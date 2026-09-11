import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { canCreateDocuments, getViewerContext, productionFilterFor } from "@/lib/access";
import {
  documentCountsByCategory,
  documentCountsByProduction,
  visibleCategories,
} from "@/lib/nav";
import { env } from "@/lib/env";
import { Sidebar } from "@/components/sidebar";
import { SearchField } from "@/components/search-field";
import { Icon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const viewer = await getViewerContext(user);

  // One batch, so the sidebar costs a single round of database latency rather
  // than one per list. Each of these is memoised for the request, so the page
  // rendering inside this layout reuses the results instead of asking again.
  const [config, categories, productions, countByCategory, countByProduction] = await Promise.all([
    getConfig(),
    visibleCategories(viewer),
    prisma.production.findMany({
      where: {
        ...productionFilterFor(viewer),
        status: { in: ["PLANNING", "ACTIVE", "CLOSED"] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
    documentCountsByCategory(viewer),
    documentCountsByProduction(viewer),
  ]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        orgName={config.orgName}
        user={{
          name: user.name,
          email: user.email,
          role: user.role,
          position: user.position,
        }}
        isAdmin={isAdmin(user)}
        driveMode={env.driveMode}
        categories={categories.map((category) => ({
          name: category.name,
          slug: category.slug,
          icon: category.icon,
          color: category.color,
          count: countByCategory.get(category.id)?.count ?? 0,
        }))}
        productions={productions.map((production) => ({
          name: production.name,
          slug: production.slug,
          status: production.status,
          count: countByProduction.get(production.id) ?? 0,
        }))}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 hidden border-b border-ink-200 bg-white/85 px-6 py-3 backdrop-blur lg:block">
          <div className="flex items-center gap-3">
            <SearchField className="max-w-md flex-1" />
            <div className="ml-auto flex items-center gap-2">
              {canCreateDocuments(viewer) ? (
                <>
                  <Link href="/documents/register" className={buttonClass("secondary")}>
                    <Icon name="link" className="size-4" />
                    Add existing
                  </Link>
                  <Link href="/documents/new" className={buttonClass("primary")}>
                    <Icon name="plus" className="size-4" />
                    New document
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>

        <footer className="border-t border-ink-200 px-6 py-4 text-xs text-ink-400">
          {config.orgName} Hub · {env.driveMode === "mock" ? "simulated Drive" : "connected to Google Drive"} ·
          private environment
        </footer>
      </div>
    </div>
  );
}
