import { getConfig } from "@/lib/config";
import { planRollover } from "@/lib/rollover";
import { RolloverForm } from "@/components/forms/access-and-checklist";
import { Banner, Card, SectionHeader, Stat } from "@/components/ui";
import { formatDateTime, pluralize } from "@/lib/utils";

/**
 * Board turnover, in one pass.
 *
 * This is the moment a club loses its institutional memory: the outgoing board
 * stops signing in, last year's shows stay "active" forever, and documents only
 * one person owns quietly become unreachable. The wizard does what it can and
 * is explicit about the one thing it cannot — private documents belong to the
 * person who filed them, and nobody else can hand them over.
 */
export default async function AdminRolloverPage() {
  const [config, plan] = await Promise.all([getConfig(), planRollover()]);

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="refresh" title="Do this once a year, when the board changes">
        Everything here is opt-in per show and per person. Nothing is deleted: archiving hides a
        show and ends its company's access, and disabling somebody keeps every document they filed
        while blocking their sign-in.
      </Banner>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Current season"
          value={config.currentSeason ?? "not set"}
          icon="calendar"
          hint={
            plan.lastRolloverAt
              ? `last rolled over ${formatDateTime(plan.lastRolloverAt)}`
              : "never rolled over"
          }
        />
        <Stat
          label="Shows to archive"
          value={plan.showsToArchive.length}
          icon="theater"
          hint="Closed, or past their closing date"
        />
        <Stat
          label="Quiet board members"
          value={plan.membersToDisable.length}
          icon="users"
          hint="No sign-in for four months"
        />
      </div>

      <Card>
        <SectionHeader
          icon="refresh"
          title="Roll the season over"
          description={`${plan.showsToArchive.length} ${pluralize(
            plan.showsToArchive.length,
            "show",
          )} and ${plan.membersToDisable.length} ${pluralize(
            plan.membersToDisable.length,
            "person",
            "people",
          )} suggested. Change any of it before you go.`}
        />
        <RolloverForm
          currentSeason={plan.currentSeason}
          shows={plan.showsToArchive}
          members={plan.membersToDisable.map((member) => ({
            ...member,
            lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
          }))}
          companyToRetire={plan.companyToRetire}
        />
      </Card>

      <Card className="bg-ink-50 text-sm text-ink-600">
        <SectionHeader icon="info" title="What rollover does not do" />
        <ul className="space-y-2">
          <li className="flex gap-2">
            <span className="text-ink-400">·</span>
            It cannot move private documents. They belong to whoever filed them — ask before the
            account goes quiet, and have them change the visibility or hand the file over in Drive.
          </li>
          <li className="flex gap-2">
            <span className="text-ink-400">·</span>
            It cannot transfer Drive ownership. Google only lets the current owner do that; Admin →
            Import has the chase-list.
          </li>
          <li className="flex gap-2">
            <span className="text-ink-400">·</span>
            With group sharing it cannot remove anybody from the Google Group. Switch to per-member
            sharing and disabling somebody takes their Drive access with it.
          </li>
        </ul>
      </Card>
    </div>
  );
}
