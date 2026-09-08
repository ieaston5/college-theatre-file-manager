import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { canvaEnabled } from "@/lib/canva";
import { digestIsDue } from "@/lib/cron";
import { canvaMirrorIsStale } from "@/lib/documents";
import { ScheduleForm } from "@/components/forms/schedule-forms";
import { Badge, Banner, Card, SectionHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatDateTime, pluralize, relativeTime } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What the hub does on its own. Three jobs, all of them safe to run twice and
 * cheap to skip, driven by one hourly request from the host.
 */
export default async function AdminScheduledPage() {
  const config = await getConfig();

  const [mirrors, staleShare] = await Promise.all([
    prisma.document.findMany({
      where: { canvaDesignId: { not: null }, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        canvaExportedAt: true,
        canvaDesignUpdatedAt: true,
        canvaCheckedAt: true,
      },
    }),
    prisma.document.count({
      where: {
        status: "ACTIVE",
        visibility: { not: "PRIVATE" },
        googleFileId: { not: null },
        ...(config.sharingSweepStartedAt
          ? {
              OR: [
                { sharingSyncedAt: null },
                { sharingSyncedAt: { lt: config.sharingSweepStartedAt } },
              ],
            }
          : { id: "never" }),
      },
    }),
  ]);

  const stale = mirrors.filter((mirror) => canvaMirrorIsStale(mirror));
  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const digestDue = digestIsDue(config);

  return (
    <div className="space-y-6">
      <Banner
        tone={cronConfigured ? "sky" : "amber"}
        icon={cronConfigured ? "clock" : "warning"}
        title={cronConfigured ? "One request an hour does all of this" : "Scheduled jobs are off"}
      >
        {cronConfigured ? (
          <>
            The host calls <code>/api/cron</code> hourly (see <code>vercel.json</code>) and each job
            decides for itself whether there is anything to do. A missed run costs nothing and a
            double run does nothing twice, so nothing here needs babysitting.
          </>
        ) : (
          <>
            <code>CRON_SECRET</code> is not set, so <code>/api/cron</code> refuses every request and
            nothing runs on its own. Set it in <code>.env</code> (and in the host's environment) to
            switch the schedule on. The buttons below work regardless.
          </>
        )}
      </Banner>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Last scheduled run"
          value={config.lastCronAt ? relativeTime(config.lastCronAt) : "never"}
          icon="clock"
          hint={config.lastCronAt ? formatDateTime(config.lastCronAt) : "no run recorded"}
        />
        <Stat
          label="Canva copies behind"
          value={stale.length}
          icon={stale.length > 0 ? "alert" : "check-circle"}
          hint={
            canvaEnabled()
              ? `${mirrors.length} ${pluralize(mirrors.length, "mirror")} tracked`
              : "Canva is off"
          }
        />
        <Stat
          label="Documents to re-share"
          value={staleShare}
          icon={staleShare > 0 ? "refresh" : "check"}
          hint={config.sharingSweepStartedAt ? "sweep in progress" : "no sweep pending"}
        />
      </div>

      <Card>
        <SectionHeader
          icon="settings"
          title="The schedule"
          description="What runs on its own, and when."
        />
        <ScheduleForm
          digestDay={config.digestDay}
          canvaAutoRefresh={config.canvaAutoRefresh}
          emailEnabled={config.emailEnabled}
          canvaAvailable={canvaEnabled()}
        />
      </Card>

      <Card>
        <SectionHeader icon="list" title="The three jobs" />
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Icon name="refresh" className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-900">Finish any re-share sweep.</span>{" "}
              <span className="text-ink-600">
                Two slices of twelve documents per run, so a sweep started by changing the sharing
                mode completes on its own instead of needing somebody to sit on the button.
              </span>{" "}
              {staleShare > 0 ? (
                <Badge tone="amber">{staleShare} waiting</Badge>
              ) : (
                <Badge tone="slate">idle</Badge>
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <Icon name="canva" className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-900">Re-export Canva mirrors.</span>{" "}
              <span className="text-ink-600">
                Canva has no “design updated” webhook, so the only way to notice an edit is to ask.
                Asking is cheap; exporting is not, so only designs that have moved on{" "}
                <em>and then gone quiet for half an hour</em> get re-exported — nobody's copy is
                taken mid-edit.
              </span>{" "}
              {stale.length > 0 ? (
                <Badge tone="amber">{stale.length} behind</Badge>
              ) : (
                <Badge tone="slate">current</Badge>
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <Icon name="mail" className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-900">Send the weekly digest.</span>{" "}
              <span className="text-ink-600">
                On the chosen day, at most once every six days, and only if email is on. Anybody
                with nothing to report is skipped.
              </span>{" "}
              <Badge tone={digestDue ? "green" : "slate"}>
                {config.digestDay === null
                  ? "no day set"
                  : digestDue
                    ? "due now"
                    : `${DAYS[config.digestDay]}s`}
              </Badge>
            </span>
          </li>
        </ul>

        {stale.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
            {stale.slice(0, 8).map((mirror) => (
              <li
                key={mirror.id}
                className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
              >
                {mirror.title}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="bg-ink-50 text-sm text-ink-600">
        <SectionHeader icon="info" title="Triggering it yourself" />
        <p className="leading-relaxed">
          The endpoint is <code className="rounded bg-white px-1">GET /api/cron</code> with{" "}
          <code className="rounded bg-white px-1">Authorization: Bearer $CRON_SECRET</code>, or{" "}
          <code className="rounded bg-white px-1">?key=$CRON_SECRET</code> if headers are awkward.
          Any scheduler can call it — Vercel Cron, GitHub Actions, or a cron line on a machine that
          is always on. It is idempotent, so calling it more often than hourly is harmless.
        </p>
        <p className="mt-2 text-xs text-ink-500">
          Environment: {env.isProduction ? "production" : "development"} ·{" "}
          {cronConfigured ? "CRON_SECRET set" : "CRON_SECRET missing"}
          {config.lastCanvaRefreshAt
            ? ` · Canva last checked ${relativeTime(config.lastCanvaRefreshAt)}`
            : ""}
        </p>
      </Card>
    </div>
  );
}
