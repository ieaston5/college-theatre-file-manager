import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { emailStatus } from "@/lib/email";
import {
  clearEmailLogAction,
  sendDigestAction,
  setEmailEnabledAction,
} from "@/app/actions/email";
import { DigestSendForm, EmailPreview } from "@/components/forms/email-admin";
import { Icon } from "@/components/icons";
import { Badge, Banner, Card, EmptyState, SectionHeader, Stat, buttonClass } from "@/components/ui";
import { EMAIL_KIND_META, type EmailKind } from "@/lib/constants";
import { formatDateTime, pluralize, relativeTime } from "@/lib/utils";

/**
 * Everything the hub says to people, and the switch that decides whether it
 * actually says it. Messages are recorded whether or not they are sent, so
 * this doubles as a preview before turning email on and an audit trail after.
 */
export default async function AdminEmailPage() {
  const status = await emailStatus();

  const [messages, optOuts, recipients] = await Promise.all([
    prisma.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.user.count({ where: { digestOptOut: true } }),
    prisma.user.count({ where: { status: "ACTIVE", digestOptOut: false } }),
  ]);

  const blocked = !status.driveConnected
    ? "The hub's Google account is not connected, so there is nothing to send from."
    : env.driveMode !== "google"
      ? "The hub is on the simulated Drive, so mail is written down rather than sent."
      : !status.hasGmailScope
        ? "The connected Google account has not granted permission to send mail. Reconnect it in Admin → Google connection — the hub now asks for gmail.send as well."
        : null;

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="mail" title="Why the hub sends its own mail">
        It goes through the Gmail API using the Google account that already owns the documents —
        no mail vendor, no domain to verify, no third party holding the board's addresses, and it
        arrives from the club's own address. Nothing is sent until you switch it on below, and every
        message is recorded either way so you can read them all first.
      </Banner>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Email"
          value={status.enabled ? "On" : "Off"}
          icon={status.enabled ? "check-circle" : "cloud_off"}
          hint={status.fromAddress ? `from ${status.fromAddress}` : "no account connected"}
        />
        <Stat label="Sent" value={status.counts.SENT ?? 0} icon="mail" />
        <Stat
          label="Written down"
          value={status.counts.LOGGED ?? 0}
          icon="doc"
          hint="Prepared but not sent"
        />
        <Stat
          label="Failed"
          value={status.counts.FAILED ?? 0}
          icon={(status.counts.FAILED ?? 0) > 0 ? "warning" : "check"}
        />
      </div>

      <Card>
        <SectionHeader
          icon="settings"
          title="Sending"
          description={`${recipients} ${pluralize(
            recipients,
            "person",
            "people",
          )} would receive the digest${optOuts > 0 ? `, ${optOuts} opted out` : ""}.`}
        />

        {blocked ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
            {blocked}
          </div>
        ) : null}

        <form action={setEmailEnabledAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="enabled" value={status.enabled ? "false" : "true"} />
          <button
            type="submit"
            className={buttonClass(status.enabled ? "danger" : "primary")}
            disabled={!status.enabled && Boolean(blocked)}
          >
            <Icon name={status.enabled ? "cloud_off" : "mail"} className="size-4" />
            {status.enabled ? "Turn email off" : "Turn email on"}
          </button>
          <span className="text-xs text-ink-500">
            {status.enabled
              ? "Onboarding notes and private-share notices go out as they happen."
              : "Messages are prepared and listed below, but nobody receives anything."}
          </span>
        </form>
      </Card>

      <Card>
        <SectionHeader
          icon="clock"
          title="Weekly digest"
          description={
            status.lastDigestAt
              ? `Last run ${relativeTime(status.lastDigestAt)}.`
              : "Never run. Automatic scheduling comes with the deployment work; for now it is a button."
          }
        />
        <p className="mb-3 text-sm leading-relaxed text-ink-600">
          The useful half is what <em>hasn't</em> happened: categories that have gone quiet, a show
          with nothing filed against it, a Canva copy that is behind the original, people added who
          never signed in. Each person's digest is built through their own visibility, so nobody
          learns about a document they could not otherwise see — and anyone with nothing to report
          is skipped rather than sent an empty note.
        </p>
        <DigestSendForm />
      </Card>

      <Card>
        <SectionHeader
          icon="list"
          title="What the hub sends"
          description="Four kinds of message, and no others."
        />
        <ul className="space-y-2 text-sm">
          {(Object.keys(EMAIL_KIND_META) as EmailKind[]).map((kind) => (
            <li key={kind} className="flex flex-wrap gap-2">
              <Badge tone="slate">{EMAIL_KIND_META[kind].label}</Badge>
              <span className="text-ink-600">{EMAIL_KIND_META[kind].blurb}</span>
            </li>
          ))}
        </ul>
      </Card>

      {messages.length === 0 ? (
        <EmptyState icon="mail" title="Nothing has been prepared yet">
          Add a member or share a private document and the message will appear here.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
            <SectionHeader
              icon="mail"
              title={`Last ${messages.length} messages`}
              description="Click one to read exactly what was, or would have been, sent."
            />
            <form action={clearEmailLogAction}>
              <button type="submit" className={buttonClass("ghost")}>
                <Icon name="trash" className="size-4" />
                Clear the log
              </button>
            </form>
          </div>
          <ul className="divide-y divide-ink-100">
            {messages.map((message) => (
              <li key={message.id} className="px-5 py-2.5">
                <EmailPreview
                  message={{
                    id: message.id,
                    to: message.to,
                    subject: message.subject,
                    body: message.body,
                    kind: message.kind,
                    status: message.status,
                    error: message.error,
                    createdAt: formatDateTime(message.createdAt),
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
