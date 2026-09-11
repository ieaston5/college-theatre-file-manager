import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { canvaEnabled } from "@/lib/canva";
import { digestIsDue } from "@/lib/cron";
import { canvaMirrorIsStale } from "@/lib/canva/freshness";
import { sharingProgress } from "@/lib/sharing";
import { ScheduleForm } from "@/components/forms/schedule-forms";
import { Badge, Banner, Card, SectionHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatDateTime, pluralize, relativeTime } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What the hub does on its own. Three jobs, all of them safe to run twice and
 * cheap to skip, driven by one scheduled request from the host.
 */
export default async function AdminScheduledPage() {
  const config = await getConfig();

  const [mirrors, sharing] = await Promise.all([
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
    sharingProgress(),
  ]);

  const stale = mirrors.filter((mirror) => canvaMirrorIsStale(mirror));
  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const digestDue = digestIsDue(config);

  return (
    <div className="space-y-6">
      <Banner
        tone={cronConfigured ? "sky" : "amber"}
        icon={cronConfigured ? "clock" : "warning"}
        title={cronConfigured ? "One request does all of this" : "Scheduled jobs are off"}
      >
        {cronConfigured ? (
          <>
            The host calls <code>/api/cron</code> on a schedule (see <code>vercel.json</code>, which
            ships set to once a day — Vercel&rsquo;s free plan allows no more often than that) and
            each job decides for itself whether there is anything to do. A missed run costs nothing
            and a double run does nothing twice, so nothing here needs babysitting. The buttons
            below do the same work immediately when you cannot wait for the next run.
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
          value={sharing.pending}
          icon={sharing.pending > 0 ? "refresh" : "check"}
          hint={
            sharing.pending > 0
              ? `${sharing.done} of ${sharing.total} done`
              : "Drive matches the hub"
          }
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
        <SectionHeader icon="list" title="The jobs" />
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Icon name="clock" className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-900">Ask Drive what has changed.</span>{" "}
              <span className="text-ink-600">
                Every list is ordered and labelled by when a document was last edited, which for
                anything in Drive is a fact only Google holds — somebody opens the schedule and
                types, and nothing tells the hub. One query for everything modified since the last
                run keeps that honest without costing a Google call per row of every page.
              </span>{" "}
              <Badge tone={config.lastDriveScanAt ? "slate" : "amber"}>
                {config.lastDriveScanAt
                  ? `read up to ${formatDateTime(config.lastDriveScanAt)}`
                  : "never run"}
              </Badge>
            </span>
          </li>
          <li className="flex gap-3">
            <Icon name="refresh" className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-900">Finish the re-share queue.</span>{" "}
              <span className="text-ink-600">
                Twelve documents at a time for as long as the run has left. This is the backstop,
                not the normal route: an access change queues the documents it affects and pushes
                them to Drive behind its own response, so what turns up here is a catch-up whose
                browser was closed part-way through.
              </span>{" "}
              {sharing.pending > 0 ? (
                <Badge tone="amber">{sharing.pending} waiting</Badge>
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
                taken mid-edit. Opening a mirrored document also checks it there and then, so this
                job is really a backstop for the ones nobody has looked at.
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
          Any scheduler can call it — Vercel Cron, GitHub Actions, cron-job.org, or a cron line on a
          machine that is always on. It is idempotent, so calling it more often than the host does
          is harmless, and that is the free way to get hourly runs on a plan that only allows a
          daily one (SETUP.md, step 3d).
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
