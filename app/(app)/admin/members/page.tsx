import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { setMemberStatusAction, stepDownFromBoardAction } from "@/app/actions/admin";
import { FormCard, MemberForm } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Banner, Card, EmptyState, SectionHeader, buttonClass } from "@/components/ui";
import { ROLE_META, USER_STATUS_META, isRole, type UserStatus } from "@/lib/constants";
import { pluralize, relativeTime } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

/**
 * Two populations, deliberately kept apart:
 *
 *  - the board, who get hub-wide access by role;
 *  - company members, who get nothing except what a production role allows on
 *    the shows they are on, and who are added from the show itself.
 */
export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const me = await getCurrentUser();
  const editId = typeof params.edit === "string" ? params.edit : undefined;
  const tab = params.tab === "company" ? "company" : "board";

  const [board, company, editing, productions] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] } },
      orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            documents: true,
            // Board members are often cast or crewed as well; whether they are
            // decides what taking them off the board should do to them.
            memberships: {
              where: { status: "ACTIVE", production: { status: { not: "ARCHIVED" } } },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { OR: [{ role: "COMPANY" }, { memberships: { some: {} } }] },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: {
            production: { select: { name: true, slug: true, status: true } },
            role: { select: { name: true } },
          },
        },
      },
    }),
    editId ? prisma.user.findUnique({ where: { id: editId } }) : Promise.resolve(null),
    prisma.production.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "CLOSED"] } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        _count: { select: { members: { where: { status: "ACTIVE" } } } },
      },
    }),
  ]);

  const tabClass = (active: boolean) =>
    active
      ? "rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
      : "rounded-lg px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-ink-200 bg-white p-1">
        <Link href="/admin/members" className={tabClass(tab === "board")}>
          Board ({board.length})
        </Link>
        <Link href="/admin/members?tab=company" className={tabClass(tab === "company")}>
          Company ({company.length})
        </Link>
      </div>

      {tab === "board" ? (
        <>
          <Banner tone="sky" icon="info" title="How board access works">
            Everyone on this list sees the whole hub. Adding an email does not send an invitation —
            tell them the hub's address and they sign in with that Google account. Cast and crew do
            not belong here: they sign in too, but only see their own show.
          </Banner>

          <FormCard
            title={editing ? `Edit ${editing.name ?? editing.email}` : "Add a board member"}
            description={
              editing
                ? "Changing the email changes which Google account can sign in as this person."
                : "Use their board Gmail address. For cast and crew, add them to a production instead — see the Company tab."
            }
          >
            <MemberForm
              key={editing?.id ?? "new"}
              member={
                editing
                  ? {
                      id: editing.id,
                      email: editing.email,
                      name: editing.name,
                      position: editing.position,
                      role: editing.role,
                    }
                  : undefined
              }
            />
          </FormCard>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionHeader icon="users" title={`${board.length} on the board`} />
            </div>
            <ul className="divide-y divide-ink-100">
              {board.map((member) => {
                const status = USER_STATUS_META[member.status as UserStatus];
                const isMe = member.id === me?.id;
                return (
                  <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Avatar name={member.name} email={member.email} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink-900">
                          {member.name ?? member.email}
                        </span>
                        {isMe ? <Badge tone="violet">You</Badge> : null}
                        <Badge tone={member.role === "ADMIN" ? "indigo" : "slate"}>
                          {isRole(member.role) ? ROLE_META[member.role].label : member.role}
                        </Badge>
                        <Badge tone={status?.tone ?? "slate"}>
                          {status?.label ?? member.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-500">
                        {member.email}
                        {member.position ? ` · ${member.position}` : ""} ·{" "}
                        {member._count.documents} filed
                        {member._count.memberships > 0
                          ? ` · on ${member._count.memberships} current ${pluralize(
                              member._count.memberships,
                              "show",
                            )}`
                          : ""}
                        {member.lastLoginAt ? ` · last in ${relativeTime(member.lastLoginAt)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/admin/members?edit=${member.id}`}
                        className={buttonClass("ghost", "px-2")}
                        aria-label={`Edit ${member.email}`}
                      >
                        <Icon name="pencil" className="size-4" />
                      </Link>
                      {!isMe && member.status !== "DISABLED" ? (
                        <form action={stepDownFromBoardAction}>
                          <input type="hidden" name="id" value={member.id} />
                          <button
                            type="submit"
                            className={buttonClass("ghost", "px-2")}
                            aria-label={`Take ${member.email} off the board`}
                            title={
                              member._count.memberships > 0
                                ? `Take them off the board. They stay on the hub as a company member and keep access to the ${member._count.memberships} current ${pluralize(
                                    member._count.memberships,
                                    "show",
                                  )} they are working on.`
                                : "Take them off the board. They can still sign in, but see nothing until they are added to a show."
                            }
                          >
                            <Icon name="user-minus" className="size-4" />
                          </button>
                        </form>
                      ) : null}
                      {!isMe ? (
                        <form action={setMemberStatusAction}>
                          <input type="hidden" name="id" value={member.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={member.status === "DISABLED" ? "ACTIVE" : "DISABLED"}
                          />
                          <button
                            type="submit"
                            className={buttonClass("ghost", "px-2")}
                            aria-label={
                              member.status === "DISABLED"
                                ? `Re-enable ${member.email}`
                                : `Disable ${member.email}`
                            }
                            title={
                              member.status === "DISABLED"
                                ? "Re-enable access"
                                : member._count.memberships > 0
                                  ? `Block sign-in entirely — including the ${member._count.memberships} current ${pluralize(
                                      member._count.memberships,
                                      "show",
                                    )} they are working on. To end a board term only, take them off the board instead.`
                                  : "Disable access (keeps their documents)"
                            }
                          >
                            <Icon
                              name={member.status === "DISABLED" ? "check" : "x"}
                              className="size-4"
                            />
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="bg-ink-50 text-sm text-ink-600">
            <SectionHeader icon="shield" title="What each role can do" />
            <ul className="space-y-2">
              {(["ADMIN", "BOARD", "MEMBER", "COMPANY"] as const).map((role) => (
                <li key={role} className="flex gap-2">
                  <Badge tone={role === "ADMIN" ? "indigo" : role === "COMPANY" ? "green" : "slate"}>
                    {ROLE_META[role].label}
                  </Badge>
                  <span>{ROLE_META[role].blurb}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              When a board term ends, take the person off the board rather than disabling them:
              board access stops, and anyone who is still cast or crewed on a show keeps exactly
              what that show allows. Disabling is the stronger one — it blocks their sign-in
              outright, shows and all. Either way everything they filed stays, and private
              documents stay private to them, so ask departing board members to hand over anything
              the club needs.
            </p>
          </Card>
        </>
      ) : (
        <>
          <Banner tone="green" icon="theater" title="Company members are added from the show">
            Cast and crew get access through a production, not through the board list — that way
            their access ends when the show does, and you never have to think about which documents
            to hide. Pick a show below to add people.
          </Banner>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionHeader icon="theater" title="Add people to a show" />
            </div>
            <ul className="divide-y divide-ink-100">
              {productions.map((production) => (
                <li key={production.id}>
                  <Link
                    href={`/productions/${production.slug}/company`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50"
                  >
                    <Icon name="theater" className="size-4 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {production.name}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {production._count.members}{" "}
                        {pluralize(production._count.members, "person", "people")} in the company
                      </span>
                    </span>
                    <Icon name="chevron-right" className="size-4 shrink-0 text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {company.length === 0 ? (
            <EmptyState icon="users" title="No company members yet">
              Add cast and crew from a production's company page.
            </EmptyState>
          ) : (
            <Card className="p-0">
              <div className="p-5 pb-3">
                <SectionHeader
                  icon="users"
                  title={`${company.length} company ${pluralize(company.length, "member")}`}
                  description="Across every current show. Someone with no active production has no access at all."
                />
              </div>
              <ul className="divide-y divide-ink-100">
                {company.map((person) => {
                  const status = USER_STATUS_META[person.status as UserStatus];
                  return (
                    <li key={person.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Avatar name={person.name} email={person.email} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink-900">
                            {person.name ?? person.email}
                          </span>
                          {person.role !== "COMPANY" ? (
                            <Badge tone="indigo">
                              {isRole(person.role) ? ROLE_META[person.role].label : person.role}
                            </Badge>
                          ) : null}
                          <Badge tone={status?.tone ?? "slate"}>
                            {status?.label ?? person.status}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">{person.email}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {person.memberships.length === 0 ? (
                            <span className="text-xs text-amber-700">
                              Not on any current show — sees nothing.
                            </span>
                          ) : (
                            person.memberships.map((membership) => (
                              <Link
                                key={membership.id}
                                href={`/productions/${membership.production.slug}/company`}
                                className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-200"
                              >
                                {membership.production.name} ·{" "}
                                {membership.role?.name ?? "no role"}
                                {membership.title ? ` · ${membership.title}` : ""}
                              </Link>
                            ))
                          )}
                        </div>
                      </div>
                      {person.status !== "DISABLED" ? (
                        <form action={setMemberStatusAction}>
                          <input type="hidden" name="id" value={person.id} />
                          <input type="hidden" name="status" value="DISABLED" />
                          <button
                            type="submit"
                            className={buttonClass("ghost", "px-2")}
                            title="Block sign-in entirely (their production access stays recorded)"
                            aria-label={`Disable ${person.email}`}
                          >
                            <Icon name="x" className="size-4" />
                          </button>
                        </form>
                      ) : (
                        <form action={setMemberStatusAction}>
                          <input type="hidden" name="id" value={person.id} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <button
                            type="submit"
                            className={buttonClass("ghost", "px-2")}
                            title="Allow sign-in again"
                            aria-label={`Re-enable ${person.email}`}
                          >
                            <Icon name="check" className="size-4" />
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
