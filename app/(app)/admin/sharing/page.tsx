import Link from "next/link";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sharingSweepStatus } from "@/lib/documents";
import { GroupAuditForm, SharingSweep } from "@/components/forms/sharing-sweep";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, SectionHeader, Stat } from "@/components/ui";
import { SHARE_MODE_META, type ShareMode } from "@/lib/constants";
import { pluralize, relativeTime } from "@/lib/utils";

/**
 * Who can reach the club's documents inside Google Drive, as opposed to on
 * the hub. The two are separate systems, and this page exists to make any
 * disagreement between them visible.
 */
export default async function AdminSharingPage() {
  const config = await getConfig();
  const status = await sharingSweepStatus();
  const mode = config.shareMode as ShareMode;

  const [boardCount, sharedCount, companyCount, privateCount, lastSynced, staleCount] =
    await Promise.all([
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
    ]);

  const disabledMembers = await prisma.user.count({
    where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: "DISABLED" },
  });

  const permissionsPerBoardFile = mode === "MEMBERS" ? boardCount : 1;

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="Two systems, one list">
        The hub decides what people <em>see listed</em>; Drive decides what they can{" "}
        <em>open</em>. The hub keeps the two in step whenever a document or a member changes — this
        page is for the times they drift apart, and for changing how board documents reach the
        board in the first place.
      </Banner>

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
          hint={staleCount > 0 ? "Run the sweep" : "All pushed to Drive"}
        />
      </div>

      <Card>
        <SectionHeader
          icon={SHARE_MODE_META[mode]?.icon ?? "users"}
          title="How board documents reach the board"
          description="Change this in Settings — it is the single most consequential setting in the hub."
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={mode === "MEMBERS" ? "green" : "indigo"}>
              {SHARE_MODE_META[mode]?.label ?? mode}
            </Badge>
            {mode === "GROUP" && config.groupEmail ? (
              <span className="font-mono text-xs text-ink-600">{config.groupEmail}</span>
            ) : null}
            <Link href="/admin" className="text-xs font-medium text-brand-700 hover:underline">
              Change in Settings →
            </Link>
          </div>

          <p className="text-sm leading-relaxed text-ink-600">
            {SHARE_MODE_META[mode]?.blurb}
          </p>

          {mode === "GROUP" && disabledMembers > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <span className="font-semibold">
                {disabledMembers} {pluralize(disabledMembers, "person", "people")} disabled on the
                hub.
              </span>{" "}
              With group sharing the hub cannot remove them from Drive — if they are still in the
              Google Group, they can still open every board document. Either take them out of the
              group by hand, or switch to per-member sharing and run the sweep.
            </div>
          ) : null}

          {mode === "MEMBERS" ? (
            <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
              Each board document carries {boardCount} individual{" "}
              {pluralize(boardCount, "permission")} plus the creator. Adding or disabling a board
              member changes what Drive allows on the next sweep. The Google Group still matters
              for email; it just no longer decides access.
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
        <SharingSweep running={status.running} remaining={status.remaining} total={status.total} />
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Runs in slices and can be stopped and picked up later, because per-member sharing means
          one Google call per person per document. Normal changes — creating a document, changing
          its visibility, adding somebody to a show — are applied immediately and do not need this.
        </p>
      </Card>

      {mode === "GROUP" ? (
        <Card>
          <SectionHeader
            icon="shield"
            title="Check the group against the hub"
            description="Worth doing at board turnover. Google gives no API for a consumer group's membership, so this is a paste-and-compare."
          />
          <GroupAuditForm />
        </Card>
      ) : null}

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
