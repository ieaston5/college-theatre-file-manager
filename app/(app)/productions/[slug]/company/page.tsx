import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { canCreateDocuments, getViewerContext, visibleProductionIds } from "@/lib/access";
import { removeMembershipAction, resyncProductionSharingAction } from "@/app/actions/company";
import {
  AddCompanyMembersForm,
  CopyInviteButton,
  MembershipRow,
  type RoleOption,
} from "@/components/forms/company-forms";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, PageHeader, SectionHeader, buttonClass } from "@/components/ui";
import { pluralize, relativeTime } from "@/lib/utils";

/**
 * Everyone working on one show, and what each of them can see. This is where a
 * production manager spends five minutes at the start of a process and then
 * never thinks about access again.
 */
export default async function ProductionCompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUser();
  const viewer = await getViewerContext(user);
  const { slug } = await params;

  const production = await prisma.production.findUnique({ where: { slug } });
  if (!production) notFound();

  const allowed = visibleProductionIds(viewer);
  if (allowed !== null && !allowed.includes(production.id)) notFound();

  const canManage = canCreateDocuments(viewer);

  const [members, roles, companyDocCount] = await Promise.all([
    prisma.productionMember.findMany({
      where: { productionId: production.id, status: "ACTIVE" },
      include: {
        user: { select: { name: true, email: true, status: true, role: true, lastLoginAt: true } },
        role: { select: { id: true, name: true, sortOrder: true } },
      },
      orderBy: [{ role: { sortOrder: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.productionRole.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        categories: {
          where: { archived: false },
          orderBy: { sortOrder: "asc" },
          select: { name: true },
        },
      },
    }),
    prisma.document.count({
      // This show's company documents, and only this show's: a company
      // document that names no production reaches no company at all.
      where: { visibility: "COMPANY", status: "ACTIVE", productionId: production.id },
    }),
  ]);

  const roleOptions: RoleOption[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isDefault: role.isDefault,
    canCreate: role.canCreate,
    categoryNames: role.categories.map((category) => category.name),
  }));

  // Group by role for the list.
  const grouped = new Map<string, typeof members>();
  for (const member of members) {
    const key = member.role?.name ?? "No role";
    grouped.set(key, [...(grouped.get(key) ?? []), member]);
  }

  const notSignedIn = members.filter((member) => member.user.status === "INVITED");

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/productions" className="hover:text-ink-800">
          Productions
        </Link>
        <Icon name="chevron-right" className="size-3" />
        <Link href={`/productions/${production.slug}`} className="hover:text-ink-800">
          {production.name}
        </Link>
      </nav>

      <PageHeader
        eyebrow={production.season ?? undefined}
        title={`${production.name} company`}
        description={
          canManage
            ? `${members.length} ${pluralize(
                members.length,
                "person",
                "people",
              )} on this show. What each of them can see is decided by their role — nothing else on the hub is visible to them.`
            : `${members.length} ${pluralize(
                members.length,
                "person",
                "people",
              )} working on this show, grouped by what they are doing.`
        }
        action={
          <Link href={`/productions/${production.slug}`} className={buttonClass("secondary")}>
            <Icon name="folder-open" className="size-4" />
            The show's documents
          </Link>
        }
      />

      {canManage ? (
        <Card>
          <SectionHeader
            icon="user-plus"
            title="Add people"
            description="Paste the cast list. One line each, or a column from a contact sheet."
          />
          <AddCompanyMembersForm
            productionId={production.id}
            productionName={production.name}
            roles={roleOptions}
          />
        </Card>
      ) : null}

      {members.length === 0 ? (
        <EmptyState icon="users" title="Nobody has been added yet">
          Add the company and they will be able to see the {companyDocCount}{" "}
          {pluralize(companyDocCount, "document")} already marked for the company — the schedule,
          the contact sheet, the script — and nothing else.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([roleName, list]) => {
            const role = roles.find((item) => item.name === roleName);
            return (
              <Card key={roleName} className="p-0">
                <div className="flex flex-wrap items-start justify-between gap-2 p-4 pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-900">
                      {roleName}{" "}
                      <span className="font-normal text-ink-400">
                        · {list.length} {pluralize(list.length, "person", "people")}
                      </span>
                    </h3>
                    {/* What a role opens up is an access decision, so it is
                        shown to the people who make it rather than to the
                        company at large. */}
                    {canManage ? (
                      <p className="mt-0.5 text-xs text-ink-500">
                        {role
                          ? `Can see: ${
                              role.categories.map((category) => category.name).join(", ") ||
                              "nothing yet"
                            }`
                          : "This role no longer exists — reassign these people."}
                      </p>
                    ) : null}
                  </div>
                  {!role && canManage ? <Badge tone="rose">Needs attention</Badge> : null}
                </div>
                <ul className="divide-y divide-ink-100 border-t border-ink-100">
                  {list.map((member) => (
                    <MembershipRow
                      key={member.id}
                      canEdit={canManage}
                      membership={{
                        id: member.id,
                        title: member.title,
                        roleId: member.roleId,
                        userName: member.user.name,
                        userEmail: member.user.email,
                        userStatus: member.user.status,
                        lastLoginAt: member.user.lastLoginAt?.toISOString() ?? null,
                      }}
                      roles={roleOptions}
                      onRemove={
                        canManage ? (
                          <form action={removeMembershipAction}>
                            <input type="hidden" name="id" value={member.id} />
                            <button
                              type="submit"
                              className={buttonClass("ghost", "px-2")}
                              aria-label={`Remove ${member.user.email} from ${production.name}`}
                              title="Remove from the show (also removes their Drive access)"
                            >
                              <Icon name="x" className="size-4" />
                            </button>
                          </form>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {canManage && members.length > 0 ? (
        <Card>
          <SectionHeader
            icon="mail"
            title="Tell them it exists"
            description="The hub does not send email yet, so send this however you already talk to the company."
          />
          <CopyInviteButton
            emails={members.map((member) => member.user.email)}
            appUrl={env.appUrl}
            productionName={production.name}
          />
          {notSignedIn.length > 0 ? (
            <p className="mt-3 text-xs text-ink-500">
              {notSignedIn.length} of {members.length} have not signed in yet
              {notSignedIn.length <= 6
                ? `: ${notSignedIn.map((member) => member.user.email).join(", ")}`
                : ""}
              .
            </p>
          ) : (
            <p className="mt-3 text-xs text-ink-500">
              Everyone has signed in at least once. Most recent:{" "}
              {relativeTime(
                members
                  .map((member) => member.user.lastLoginAt)
                  .filter((date): date is Date => Boolean(date))
                  .sort((a, b) => b.getTime() - a.getTime())[0],
              )}
              .
            </p>
          )}
        </Card>
      ) : null}

      {canManage ? (
        <Banner
          tone="slate"
          icon="refresh"
          title="If Drive and the hub ever disagree"
          action={
            <form action={resyncProductionSharingAction}>
              <input type="hidden" name="productionId" value={production.id} />
              <button type="submit" className={buttonClass("secondary")}>
                Re-share with the company
              </button>
            </form>
          }
        >
          Sharing is applied automatically when people are added, removed or moved between roles.
          This button re-applies it to all {companyDocCount} company{" "}
          {pluralize(companyDocCount, "document")} for this show, for when a Google call failed
          earlier.
        </Banner>
      ) : null}
    </div>
  );
}
