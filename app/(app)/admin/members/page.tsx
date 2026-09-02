import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { setMemberStatusAction } from "@/app/actions/admin";
import { FormCard, MemberForm } from "@/components/forms/admin-forms";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Banner, Card, SectionHeader, buttonClass } from "@/components/ui";
import { ROLE_META, USER_STATUS_META, isRole, type UserStatus } from "@/lib/constants";
import { relativeTime } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const me = await getCurrentUser();
  const editId = typeof params.edit === "string" ? params.edit : undefined;

  const [members, editing] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
      include: { _count: { select: { documents: true } } },
    }),
    editId ? prisma.user.findUnique({ where: { id: editId } }) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="How access works">
        Someone can only sign in if they are on this list. Adding an email does not send an
        invitation — tell them the hub's address and they sign in with that Google account.
      </Banner>

      <FormCard
        title={editing ? `Edit ${editing.name ?? editing.email}` : "Add a member"}
        description={
          editing
            ? "Changing the email changes which Google account can sign in as this person."
            : "Use their board Gmail address."
        }
      >
        <MemberForm
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
          <SectionHeader icon="users" title={`${members.length} on the list`} />
        </div>
        <ul className="divide-y divide-ink-100">
          {members.map((member) => {
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
                    <Badge tone={status?.tone ?? "slate"}>{status?.label ?? member.status}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-500">
                    {member.email}
                    {member.position ? ` · ${member.position}` : ""} · {member._count.documents}{" "}
                    filed
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
          {(["ADMIN", "BOARD", "MEMBER"] as const).map((role) => (
            <li key={role} className="flex gap-2">
              <Badge tone={role === "ADMIN" ? "indigo" : "slate"}>{ROLE_META[role].label}</Badge>
              <span>{ROLE_META[role].blurb}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          Disabling someone keeps everything they filed and immediately blocks their sign-in.
          Private documents stay private to them — nobody inherits them, so ask departing board
          members to hand over anything the club needs.
        </p>
      </Card>
    </div>
  );
}
