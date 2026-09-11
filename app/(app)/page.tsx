import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig, getSetupState } from "@/lib/config";
import {
  canCreateDocuments,
  getViewerContext,
  productionFilterFor,
  visibleDocumentsWhere,
} from "@/lib/access";
import {
  documentCountsByCategory,
  documentCountsByProduction,
  visibleCategories,
} from "@/lib/nav";
import { env } from "@/lib/env";
import { CompanyDashboard } from "@/components/company-dashboard";
import { DocumentList, type DocumentListItem } from "@/components/document-items";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, PageHeader, SectionHeader, Stat, buttonClass } from "@/components/ui";
import { PRODUCTION_STATUS_META, type ProductionStatus } from "@/lib/constants";
import { formatDate, pluralize, relativeTime } from "@/lib/utils";

const LIST_INCLUDE = {
  category: { select: { name: true, slug: true, icon: true, color: true } },
  production: { select: { name: true, slug: true } },
  creator: { select: { name: true, email: true } },
} as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const viewer = await getViewerContext(user);

  // Prefer the name as entered; fall back to the local part of the email.
  const rawName = user.name?.trim() || user.email.split("@")[0].replace(/[._-]+/g, " ");
  const greeting = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  if (!viewer.isBoard) {
    const config = await getConfig();
    return <CompanyDashboard viewer={viewer} orgName={config.orgName} greeting={greeting} />;
  }

  const where = visibleDocumentsWhere(viewer);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const admin = isAdmin(user);

  /**
   * Everything in one round, rather than the three the dashboard used to take:
   * the setup state, then ten queries, then the per-production tally. Those
   * ran back to back, so the page waited out three lots of database latency
   * before it could render anything.
   */
  const [
    config,
    setup,
    categories,
    activeProductions,
    pinned,
    recent,
    mine,
    totalCount,
    weekCount,
    privateCount,
    countByCategory,
    countByProduction,
    sampleCount,
  ] = await Promise.all([
    getConfig(),
    // Nothing but the admin setup banner reads this, and answering it means a
    // Drive account lookup and two more counts. Everyone else skips it.
    admin ? getSetupState() : null,
    visibleCategories(viewer),
    prisma.production.findMany({
      where: { ...productionFilterFor(viewer), status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: [{ status: "asc" }, { opensOn: "asc" }],
      take: 4,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", pinned: true },
      include: LIST_INCLUDE,
      orderBy: { lastEditedAt: "desc" },
      take: 5,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE" },
      include: LIST_INCLUDE,
      orderBy: { lastEditedAt: "desc" },
      take: 8,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", creatorId: user.id },
      include: LIST_INCLUDE,
      orderBy: { lastEditedAt: "desc" },
      take: 5,
    }),
    prisma.document.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.document.count({ where: { ...where, status: "ACTIVE", lastEditedAt: { gte: weekAgo } } }),
    prisma.document.count({
      where: { status: "ACTIVE", visibility: "PRIVATE", creatorId: user.id },
    }),
    documentCountsByCategory(viewer),
    documentCountsByProduction(viewer),
    // A LIKE over every document's metadata, and no index can serve it. Only
    // the admin banner below reads the answer, so only admins pay for it.
    admin ? prisma.document.count({ where: { metadata: { contains: '"sample":true' } } }) : 0,
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={config.currentSeason ?? undefined}
        title={`Hello, ${greeting}`}
        description="Everything the board keeps — sorted by what it is and which show it belongs to."
        action={
          canCreateDocuments(viewer) ? (
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
          ) : null
        }
      />

      {setup && !setup.driveConnected ? (
        <Banner
          tone="amber"
          icon="warning"
          title="One thing left before the hub is live"
          action={
            <Link href="/admin" className={buttonClass("secondary")}>
              Open admin
            </Link>
          }
        >
          <ul className="mt-1 space-y-1">
            {!setup.driveConnected ? (
              <li>
                {env.driveMode === "mock"
                  ? "Google Drive is simulated right now — documents are fake until an admin connects the hub's Google account."
                  : "Connect the Google account that should own every hub document."}
              </li>
            ) : null}
          </ul>
        </Banner>
      ) : null}

      {admin && sampleCount > 0 ? (
        <Banner
          tone="slate"
          icon="info"
          title={`${sampleCount} sample ${pluralize(sampleCount, "document")} are loaded`}
          action={
            <Link href="/admin" className={buttonClass("secondary")}>
              Clear sample data
            </Link>
          }
        >
          They are here so you can see what a full hub feels like. Clear them whenever you are ready
          to use the hub for real.
        </Banner>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Documents" value={totalCount} icon="folder" href="/documents" />
        <Stat
          label="Edited this week"
          value={weekCount}
          icon="clock"
          hint={weekCount === 0 ? "Quiet week" : "Changed in the last 7 days"}
        />
        <Stat
          label="Productions"
          value={activeProductions.length}
          icon="theater"
          href="/productions"
          hint={activeProductions.map((show) => show.name).join(", ") || "None on the books"}
        />
        <Stat
          label="Your private files"
          value={privateCount}
          icon="lock"
          hint="Only you can see these"
        />
      </div>

      {pinned.length > 0 ? (
        <section>
          <SectionHeader
            icon="pin"
            title="Pinned"
            description="What the board needs at hand right now."
          />
          <DocumentList documents={pinned as DocumentListItem[]} />
        </section>
      ) : null}

      <section>
        <SectionHeader
          icon="grid"
          title="By type of information"
          description="The shelf each kind of document lives on."
          action={
            <Link href="/categories" className={buttonClass("ghost")}>
              Manage view
            </Link>
          }
        />
        {categories.length === 0 ? (
          <EmptyState
            icon="grid"
            title="No categories yet"
            action={
              admin ? (
                <Link href="/admin/categories" className={buttonClass("primary")}>
                  Add categories
                </Link>
              ) : null
            }
          >
            An admin needs to set up the kinds of information the board keeps.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => {
              const count = countByCategory.get(category.id)?.count ?? 0;
              return (
                <li key={category.id}>
                  <Link
                    href={`/categories/${category.slug}`}
                    className="card group flex h-full items-start gap-3 p-4 transition hover:border-brand-300 hover:shadow-sm"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg"
                      style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                    >
                      <Icon name={category.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900">
                          {category.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-400">{count}</span>
                      </span>
                      {category.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-500">
                          {category.description}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activeProductions.length > 0 ? (
        <section>
          <SectionHeader
            icon="theater"
            title="On the books"
            description="Everything filed against each show."
            action={
              <Link href="/productions" className={buttonClass("ghost")}>
                All productions
              </Link>
            }
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {activeProductions.map((production) => {
              const meta = PRODUCTION_STATUS_META[production.status as ProductionStatus];
              return (
                <li key={production.id}>
                  <Link
                    href={`/productions/${production.slug}`}
                    className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink-900">
                          {production.name}
                        </div>
                        <div className="text-xs text-ink-500">
                          {production.season ?? "Season not set"}
                          {production.venue ? ` · ${production.venue}` : ""}
                        </div>
                      </div>
                      <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? production.status}</Badge>
                    </div>
                    <div className="mt-auto flex items-center gap-3 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="folder" className="size-3.5" />
                        {countByProduction.get(production.id) ?? 0}{" "}
                        {pluralize(countByProduction.get(production.id) ?? 0, "document")}
                      </span>
                      {production.opensOn ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="calendar" className="size-3.5" />
                          opens {formatDate(production.opensOn)}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader
            icon="clock"
            title="Recently edited"
            action={
              <Link href="/documents" className={buttonClass("ghost")}>
                See all
              </Link>
            }
          />
          <DocumentList
            documents={recent as DocumentListItem[]}
            empty={
              <EmptyState
                icon="folder"
                title="Nothing on the hub yet"
                action={
                  canCreateDocuments(viewer) ? (
                    <Link href="/documents/new" className={buttonClass("primary")}>
                      <Icon name="plus" className="size-4" />
                      Create the first document
                    </Link>
                  ) : null
                }
              >
                Create a document here instead of in Drive and it gets named, filed and shared for
                you.
              </EmptyState>
            }
          />
        </section>

        <section>
          <SectionHeader icon="user-plus" title="Filed by you" />
          {mine.length === 0 ? (
            <Card className="text-sm text-ink-500">
              Nothing yet. Anything you create shows up here, including your private files.
            </Card>
          ) : (
            <DocumentList documents={mine as DocumentListItem[]} />
          )}
          <p className="mt-3 text-xs text-ink-400">
            Last signed in {relativeTime(user.lastLoginAt)}
          </p>
        </section>
      </div>
    </div>
  );
}
