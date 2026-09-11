import Link from "next/link";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sharingProgress } from "@/lib/sharing";
import { SharingSweep } from "@/components/forms/sharing-sweep";
import { Icon } from "@/components/icons";
import { Banner, Card, SectionHeader, Stat, buttonClass } from "@/components/ui";
import { pluralize, relativeTime } from "@/lib/utils";

/**
 * Who can reach the club's documents inside Google Drive, as opposed to on
 * the hub. The two are separate systems, and this page exists to make any
 * disagreement between them visible.
 */
export default async function AdminSharingPage() {
  const config = await getConfig();
  const progress = await sharingProgress();

  const [
    boardCount,
    sharedCount,
    companyCount,
    privateCount,
    lastSynced,
    staleCount,
    companyNoShowCount,
  ] = await Promise.all([
    prisma.user.count({
      where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: { not: "DISABLED" } },
    }),
    prisma.document.count({
      where: { visibility: "BOARD", status: "ACTIVE", googleFileId: { not: null } },
    }),
    prisma.document.count({
      where: { visibility: "COMPANY", status: "ACTIVE", googleFileId: { not: null } },
    }),
    prisma.document.count({ where: { visibility: "PRIVATE", status: "ACTIVE" } }),
    prisma.document.findFirst({
      where: { sharingSyncedAt: { not: null } },
      orderBy: { sharingSyncedAt: "desc" },
      select: { sharingSyncedAt: true },
    }),
    prisma.document.count({
      where: {
        status: "ACTIVE",
        visibility: { not: "PRIVATE" },
        googleFileId: { not: null },
        sharingSyncedAt: null,
      },
    }),
    // "Company" means the people on one show, so a company document with no
    // show reaches no company at all — it is board-only in practice. These
    // are the ones somebody filed before that was true.
    prisma.document.count({
      where: { visibility: "COMPANY", status: "ACTIVE", productionId: null },
    }),
  ]);

  const disabledMembers = await prisma.user.count({
    where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: "DISABLED" },
  });

  // One Drive permission per board member, plus the creator.
  const permissionsPerBoardFile = boardCount;

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="Two systems, one list">
        The hub decides what people <em>see listed</em>; Drive decides what they can{" "}
        <em>open</em>. The hub keeps the two in step whenever a document or a member changes — this
        page is for the times they drift apart.
      </Banner>

      {companyNoShowCount > 0 ? (
        <Banner
          tone="amber"
          icon="warning"
          title={`${companyNoShowCount} company ${pluralize(
            companyNoShowCount,
            "document",
          )} not attached to a show`}
          action={
            <Link
              href="/documents?visibility=COMPANY&production=none"
              className={buttonClass("secondary")}
            >
              Show them
            </Link>
          }
        >
          A company document belongs to one show&rsquo;s company, so these reach nobody outside the
          board. Attach each one to the production it is for, or file it for the board. Running the
          queue below takes the company&rsquo;s Drive access off them in the meantime.
        </Banner>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Board documents"
          value={sharedCount}
          icon="users"
          hint={`${permissionsPerBoardFile} Drive ${pluralize(
            permissionsPerBoardFile,
            "permission",
          )} each`}
        />
        <Stat label="Company documents" value={companyCount} icon="theater" />
        <Stat label="Private" value={privateCount} icon="lock" hint="Never shared out" />
        <Stat
          label="Never synced"
          value={staleCount}
          icon={staleCount > 0 ? "alert" : "check-circle"}
          hint={staleCount > 0 ? "Re-share everything" : "All pushed to Drive"}
        />
      </div>

      <Card>
        <SectionHeader
          icon="user-cog"
          title="How board documents reach the board"
          description="Each board member by name, taken from the members list."
        />

        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-600">
            Every board document is shared in Drive with each of the{" "}
            <Link href="/admin/members" className="font-medium text-brand-700 hover:underline">
              {boardCount} {pluralize(boardCount, "person", "people")} on the members list
            </Link>
            , so Drive access matches that list exactly — adding somebody gives them access, and
            disabling somebody takes it away. Both go through the queue below, which starts itself
            the moment the change is saved and needs nobody to sit and watch it.
          </p>

          <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
            The cost is {boardCount} individual {pluralize(boardCount, "permission")} per document
            plus the creator, which is why re-sharing runs as a queue rather than all at once.{" "}
            {config.groupEmail ? (
              <>
                <span className="font-mono">{config.groupEmail}</span> no longer decides access
              </>
            ) : (
              <>The board&rsquo;s Google Group no longer decides access</>
            )}{" "}
            — it is kept for email, and so a pass can take an old group permission back off
            documents shared before this change.
          </div>

          {disabledMembers > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <span className="font-semibold">
                {disabledMembers} {pluralize(disabledMembers, "person", "people")} disabled on the
                hub.
              </span>{" "}
              Disabling somebody queues every shared document, so their Drive access should already
              be gone. If the queue below is empty and you want to be certain, re-share everything.
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <SectionHeader
          icon="refresh"
          title="Sharing in Drive"
          description={
            lastSynced?.sharingSyncedAt
              ? `Last pushed ${relativeTime(lastSynced.sharingSyncedAt)}.`
              : "Nothing has been pushed to Drive yet."
          }
        />
        <SharingSweep initial={progress} />
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Per-member sharing means one Google call per person per document, so re-sharing is a queue
          rather than something anybody waits for: a change that moves access — adding somebody to a
          show, moving them between roles, taking somebody off the board — saves at once and the
          documents it affects are pushed to Drive in the background. This is where you can watch
          that finish, or start it again from scratch.
        </p>
      </Card>

      <Card className="bg-ink-50 text-sm text-ink-600">
        <SectionHeader icon="lock" title="What is never shared" />
        <ul className="space-y-1.5 text-sm">
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Private documents: the creator and anyone they added by hand. Not the board, not
            admins, not the group.
          </li>
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Company documents: only the people on that show whose role covers the category, as
            viewers.
          </li>
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            No "anyone with the link" permission survives a sharing pass on a document the hub
            owns — those are stripped every time.
          </li>
        </ul>
      </Card>
    </div>
  );
}
