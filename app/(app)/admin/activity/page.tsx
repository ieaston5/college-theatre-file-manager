import { prisma } from "@/lib/db";
import { auditLabel } from "@/lib/audit";
import { Avatar, Badge, Banner, Card, EmptyState, SectionHeader } from "@/components/ui";
import { formatDateTime, relativeTime } from "@/lib/utils";

export default async function AdminActivityPage() {
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true, email: true } } },
  });

  return (
    <div className="space-y-6">
      <Banner tone="sky" icon="info" title="What this log does and does not show">
        Every change to the hub is recorded here. Entries about documents somebody marked private
        deliberately leave out the title — the log tells you a private file was created in a
        category, not what it was called.
      </Banner>

      {entries.length === 0 ? (
        <EmptyState icon="clock" title="Nothing has happened yet" />
      ) : (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionHeader icon="clock" title={`Last ${entries.length} events`} />
          </div>
          <ul className="divide-y divide-ink-100">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                {entry.actor ? (
                  <Avatar name={entry.actor.name} email={entry.actor.email} size={28} />
                ) : (
                  <span className="grid size-7 place-items-center rounded-full bg-ink-100 text-xs text-ink-500">
                    ·
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="slate">{auditLabel(entry.action)}</Badge>
                    <span className="text-sm text-ink-800">{entry.summary}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-400">
                    {entry.actorEmail ?? "system"} · {formatDateTime(entry.createdAt)}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink-400">
                  {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
