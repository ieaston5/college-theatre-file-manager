import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { canDeleteDocument, canEditDocument, canViewDocument } from "@/lib/access";
import {
  deleteDocumentAction,
  setStatusAction,
  syncDocumentAction,
  togglePinAction,
  unshareDocumentAction,
} from "@/app/actions/documents";
import { DocTypeIcon } from "@/components/document-items";
import { ShareForm } from "@/components/forms/share-form";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Banner, Card, SectionHeader, buttonClass } from "@/components/ui";
import {
  DOC_TYPE_META,
  VISIBILITY_META,
  type DocType,
  type Visibility,
} from "@/lib/constants";
import { auditLabel } from "@/lib/audit";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { SearchParams } from "@/lib/queries";

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      category: true,
      production: true,
      creator: true,
      tags: true,
      shares: { include: { user: true, grantedBy: true } },
    },
  });

  if (!document || !canViewDocument(user, document)) notFound();

  const config = await getConfig();
  const canEdit = canEditDocument(user, document);
  const canRemove = canDeleteDocument(user, document);
  const visibility = VISIBILITY_META[document.visibility as Visibility];
  const typeMeta = DOC_TYPE_META[(document.docType as DocType) ?? "OTHER"] ?? DOC_TYPE_META.OTHER;

  const [shareableMembers, activity] = await Promise.all([
    canEdit
      ? prisma.user.findMany({
          where: {
            status: { not: "DISABLED" },
            id: { notIn: [document.creatorId, ...document.shares.map((share) => share.userId)] },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    canEdit
      ? prisma.auditLog.findMany({
          where: { targetType: "Document", targetId: document.id },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: { actor: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ]);

  const folderPath = document.production
    ? `Productions / ${document.production.name} / ${document.category.folderName ?? document.category.name}`
    : `Organisation-wide / ${document.category.folderName ?? document.category.name}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/documents" className="hover:text-ink-800">
          Documents
        </Link>
        <Icon name="chevron-right" className="size-3" />
        <Link href={`/categories/${document.category.slug}`} className="hover:text-ink-800">
          {document.category.name}
        </Link>
        {document.production ? (
          <>
            <Icon name="chevron-right" className="size-3" />
            <Link href={`/productions/${document.production.slug}`} className="hover:text-ink-800">
              {document.production.name}
            </Link>
          </>
        ) : null}
      </nav>

      {query.saved === "1" ? (
        <Banner tone="green" icon="check">
          Changes saved.
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <DocTypeIcon docType={document.docType} className="size-12" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{document.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={visibility?.tone ?? "slate"} icon={visibility?.icon}>
              {visibility?.label ?? document.visibility}
            </Badge>
            <Badge tone="slate">{typeMeta.label}</Badge>
            {document.pinned ? (
              <Badge tone="amber" icon="pin">
                Pinned
              </Badge>
            ) : null}
            {document.status === "ARCHIVED" ? (
              <Badge tone="slate" icon="archive">
                Archived
              </Badge>
            ) : null}
            {document.source === "REGISTERED" ? (
              <Badge tone="sky" icon="link">
                Pre-existing file
              </Badge>
            ) : null}
            {document.source === "LINK" ? (
              <Badge tone="sky" icon="external">
                External link
              </Badge>
            ) : null}
            {document.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/documents?q=${encodeURIComponent(tag.name)}`}
                className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-200"
              >
                <Icon name="tag" className="size-3" />
                {tag.name}
              </Link>
            ))}
          </div>
          {document.description ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600">
              {document.description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {document.webViewLink ? (
          <a
            href={document.webViewLink}
            target={env.driveMode === "mock" ? undefined : "_blank"}
            rel="noreferrer"
            className={buttonClass("primary")}
          >
            <Icon name="external" className="size-4" />
            Open in {document.source === "LINK" ? "a new tab" : "Google"}
          </a>
        ) : null}

        {canEdit ? (
          <>
            <Link href={`/documents/${document.id}/edit`} className={buttonClass("secondary")}>
              <Icon name="pencil" className="size-4" />
              Edit details
            </Link>
            <form action={togglePinAction}>
              <input type="hidden" name="id" value={document.id} />
              <button type="submit" className={buttonClass("secondary")}>
                <Icon name={document.pinned ? "pin-off" : "pin"} className="size-4" />
                {document.pinned ? "Unpin" : "Pin"}
              </button>
            </form>
            {document.googleFileId ? (
              <form action={syncDocumentAction}>
                <input type="hidden" name="id" value={document.id} />
                <button type="submit" className={buttonClass("secondary")}>
                  <Icon name="refresh" className="size-4" />
                  Refresh from Drive
                </button>
              </form>
            ) : null}
            <form action={setStatusAction}>
              <input type="hidden" name="id" value={document.id} />
              <input
                type="hidden"
                name="status"
                value={document.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED"}
              />
              <button type="submit" className={buttonClass("secondary")}>
                <Icon name="archive" className="size-4" />
                {document.status === "ARCHIVED" ? "Restore" : "Archive"}
              </button>
            </form>
          </>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionHeader icon="info" title="Details" />
          <dl className="space-y-2.5 text-sm">
            <Row label="Category">
              <Link href={`/categories/${document.category.slug}`} className="hover:underline">
                {document.category.name}
              </Link>
            </Row>
            <Row label="Production">
              {document.production ? (
                <Link
                  href={`/productions/${document.production.slug}`}
                  className="hover:underline"
                >
                  {document.production.name}
                </Link>
              ) : (
                <span className="text-ink-500">Not tied to a show</span>
              )}
            </Row>
            <Row label="Filed by">
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={document.creator.name} email={document.creator.email} size={20} />
                {document.creator.name ?? document.creator.email}
              </span>
            </Row>
            <Row label="Created">{formatDateTime(document.createdAt)}</Row>
            <Row label="Hub updated">{relativeTime(document.updatedAt)}</Row>
            {document.googleModifiedAt ? (
              <Row label="Drive changed">{relativeTime(document.googleModifiedAt)}</Row>
            ) : null}
            {document.driveOwnerEmail ? (
              <Row label="Drive owner">{document.driveOwnerEmail}</Row>
            ) : null}
            {document.googleFileId ? <Row label="Drive folder">{folderPath}</Row> : null}
            {document.lastSyncedAt ? (
              <Row label="Last checked">{relativeTime(document.lastSyncedAt)}</Row>
            ) : null}
          </dl>
        </Card>

        <Card>
          <SectionHeader
            icon={visibility?.icon ?? "users"}
            title="Who can see this"
            description={visibility?.label}
          />

          {document.visibility === "BOARD" ? (
            <div className="space-y-3 text-sm">
              <p className="text-ink-600">
                Everyone with hub access can see this document listed and open it.
              </p>
              <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
                {config.groupEmail ? (
                  <>
                    In Google Drive it is shared with{" "}
                    <span className="font-medium text-ink-800">{config.groupEmail}</span> as{" "}
                    {config.groupCanEdit ? "editors" : "viewers"}. Nobody outside that group has
                    access — there is no public link.
                  </>
                ) : (
                  <>
                    No board Google Group is configured yet, so this is only shared with its creator
                    in Drive. An admin can add the group in Admin → Settings and re-apply sharing.
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-ink-600">
                This is private. It is hidden from every other member's dashboard and is not shared
                with the board group in Drive.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 rounded-lg bg-ink-50 p-2 text-sm">
                  <Avatar name={document.creator.name} email={document.creator.email} size={24} />
                  <span className="min-w-0 flex-1 truncate">
                    {document.creator.name ?? document.creator.email}
                  </span>
                  <Badge tone="slate">Owner</Badge>
                </li>
                {document.shares.map((share) => (
                  <li
                    key={share.id}
                    className="flex items-center gap-2 rounded-lg bg-ink-50 p-2 text-sm"
                  >
                    <Avatar name={share.user.name} email={share.user.email} size={24} />
                    <span className="min-w-0 flex-1 truncate">
                      {share.user.name ?? share.user.email}
                    </span>
                    <Badge tone="slate">
                      {share.accessLevel === "WRITER" ? "Can edit" : "Can view"}
                    </Badge>
                    {canEdit ? (
                      <form action={unshareDocumentAction}>
                        <input type="hidden" name="documentId" value={document.id} />
                        <input type="hidden" name="userId" value={share.userId} />
                        <button
                          type="submit"
                          className="rounded p-1 text-ink-400 hover:bg-white hover:text-rose-600"
                          aria-label={`Remove ${share.user.email}`}
                        >
                          <Icon name="x" className="size-3.5" />
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canEdit ? (
                <div className="border-t border-ink-100 pt-3">
                  <ShareForm documentId={document.id} members={shareableMembers} />
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      {canEdit && activity.length > 0 ? (
        <Card>
          <SectionHeader icon="clock" title="History" />
          <ul className="space-y-2 text-sm">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-ink-600">
                <span className="font-medium text-ink-800">{auditLabel(entry.action)}</span>
                <span className="text-ink-500">{entry.summary}</span>
                <span className="ml-auto text-xs text-ink-400">
                  {relativeTime(entry.createdAt)}
                  {entry.actor ? ` · ${entry.actor.name ?? entry.actor.email}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canRemove ? (
        <details className="card border-rose-200 p-4">
          <summary className="cursor-pointer text-sm font-medium text-rose-700">
            Remove from the hub
          </summary>
          <form action={deleteDocumentAction} className="mt-3 space-y-3 text-sm">
            <input type="hidden" name="id" value={document.id} />
            <p className="text-ink-600">
              This deletes the hub's record of the document. The file itself stays in Google Drive
              unless you tick the box below.
            </p>
            {document.source === "CREATED" && document.googleFileId ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="trashInDrive"
                  className="mt-0.5 size-4 rounded border-ink-300 text-rose-600"
                />
                <span>
                  Also move the file to the Drive trash of{" "}
                  {document.driveOwnerEmail ?? "the hub's Google account"}. It can be recovered from
                  there for 30 days.
                </span>
              </label>
            ) : null}
            <button type="submit" className={buttonClass("danger")}>
              <Icon name="trash" className="size-4" />
              Remove “{document.title}”
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-right text-ink-800">{children}</dd>
    </div>
  );
}
