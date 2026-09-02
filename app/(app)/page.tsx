import Link from "next/link";
import { canCreateDocuments, isAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSetupState } from "@/lib/config";
import { visibleDocumentsWhere } from "@/lib/access";
import { env } from "@/lib/env";
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
  const where = visibleDocumentsWhere(user);
  const setup = await getSetupState();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    categories,
    activeProductions,
    pinned,
    recent,
    mine,
    totalCount,
    weekCount,
    privateCount,
    categoryCounts,
    sampleCount,
  ] = await Promise.all([
    prisma.category.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.production.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: [{ status: "asc" }, { opensOn: "asc" }],
      take: 4,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", pinned: true },
      include: LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE" },
      include: LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", creatorId: user.id },
      include: LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.document.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.document.count({ where: { ...where, status: "ACTIVE", updatedAt: { gte: weekAgo } } }),
    prisma.document.count({
      where: { status: "ACTIVE", visibility: "PRIVATE", creatorId: user.id },
    }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { ...where, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.document.count({ where: { metadata: { contains: '"sample":true' } } }),
  ]);

  const countByCategory = new Map(categoryCounts.map((row) => [row.categoryId, row._count._all]));
  const productionCounts = await prisma.document.groupBy({
    by: ["productionId"],
    where: { ...where, status: "ACTIVE" },
    _count: { _all: true },
  });
  const countByProduction = new Map(
    productionCounts.map((row) => [row.productionId ?? "", row._count._all]),
  );

  // Prefer the name as entered; fall back to the local part of the email.
  const rawName = user.name?.trim() || user.email.split("@")[0].replace(/[._-]+/g, " ");
  const greeting = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={setup.config.currentSeason ?? undefined}
        title={`Hello, ${greeting}`}
        description="Everything the board keeps — sorted by what it is and which show it belongs to."
        action={
          canCreateDocuments(user) ? (
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

      {isAdmin(user) && (!setup.driveConnected || !setup.groupConfigured) ? (
        <Banner
          tone="amber"
          icon="warning"
          title="Two things left before the hub is live"
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
            {!setup.groupConfigured ? (
              <li>Add the board's Google Group so “board” documents get shared automatically.</li>
            ) : null}
          </ul>
        </Banner>
      ) : null}

      {isAdmin(user) && sampleCount > 0 ? (
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
          label="Touched this week"
          value={weekCount}
          icon="clock"
          hint={weekCount === 0 ? "Quiet week" : "Updated in the last 7 days"}
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
              isAdmin(user) ? (
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
              const count = countByCategory.get(category.id) ?? 0;
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
            title="Recently updated"
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
                  canCreateDocuments(user) ? (
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
