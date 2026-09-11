import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";
import {
  canDeleteDocument,
  canEditDocument,
  canViewDocument,
  getViewerContext,
} from "@/lib/access";
import {
  deleteDocumentAction,
  setStatusAction,
  syncDocumentAction,
  togglePinAction,
  unshareDocumentAction,
} from "@/app/actions/documents";
import { DocTypeIcon } from "@/components/document-items";
import { RequestAccessForm } from "@/components/forms/access-and-checklist";
import { decideAccessRequestAction } from "@/app/actions/rollover";
import { ShareForm } from "@/components/forms/share-form";
import { NewVersionUploader } from "@/components/forms/new-version-uploader";
import { CanvaReexportForm } from "@/components/forms/canva-panel";
import { CanvaWatch } from "@/components/canva-watch";
import { checkCanvaFreshnessAction, simulateCanvaEditAction } from "@/app/actions/canva";
import { canvaMirrorIsStale } from "@/lib/documents";
import { CANVA_FORMAT_META, type CanvaExportFormat } from "@/lib/constants";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Banner, Card, SectionHeader, buttonClass } from "@/components/ui";
import {
  DOC_TYPE_META,
  EDIT_ACCESS_META,
  UPLOADED_DOC_TYPES,
  clampEditAccess,
  VISIBILITY_META,
  type DocType,
  type Visibility,
} from "@/lib/constants";
import { auditLabel } from "@/lib/audit";
import { formatBytes, formatDateTime, relativeTime } from "@/lib/utils";
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

  // Neither of these depends on the other, and the config is wanted either
  // way, so they go together rather than one after another.
  const [document, viewer, config] = await Promise.all([
    prisma.document.findUnique({
      where: { id },
      include: {
        category: true,
        production: true,
        creator: true,
        tags: true,
        shares: { include: { user: true, grantedBy: true } },
      },
    }),
    getViewerContext(user),
    getConfig(),
  ]);

  // Deliberately identical whether the id is unknown or simply not yours: the
  // page reveals nothing, and asking is one click. Google Drive behaves the
  // same way, and a 404 would be no more private while being less useful to
  // somebody who was legitimately sent the link.
  if (!document || !canViewDocument(viewer, document)) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Card className="text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700">
            <Icon name="lock" className="size-6" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">You do not have access to this</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
            Either it is private, it belongs to a show you are not on, or it is not on the hub at
            all. The hub will not say which.
          </p>
          <div className="mt-6 border-t border-ink-100 pt-5">
            <RequestAccessForm documentId={id} />
          </div>
          <Link href="/" className="mt-5 inline-block text-xs text-ink-500 hover:text-ink-800">
            Back to the dashboard
          </Link>
        </Card>
      </div>
    );
  }

  const canEdit = canEditDocument(viewer, document);
  const canRemove = canDeleteDocument(viewer, document);
  const visibility = VISIBILITY_META[document.visibility as Visibility];
  const typeMeta = DOC_TYPE_META[(document.docType as DocType) ?? "OTHER"] ?? DOC_TYPE_META.OTHER;
  const isUploaded =
    Boolean(document.googleFileId) && UPLOADED_DOC_TYPES.includes(document.docType as DocType);
  const isCanva = Boolean(document.canvaDesignId);
  const canvaStale = canvaMirrorIsStale(document);

  // Forms keep two links. Circulating the edit one by mistake would let
  // responders rewrite the questions, so the hub shows them separately.
  const formResponderUrl = (() => {
    if (document.docType !== "FORM" || !document.metadata) return null;
    try {
      const parsed = JSON.parse(document.metadata) as { formResponderUrl?: string };
      return parsed.formResponderUrl ?? null;
    } catch {
      return null;
    }
  })();

  // The audience, the pending requests, the share picker and the history are
  // independent of one another; awaiting them in turn cost four rounds of
  // database latency on a page that needs one.
  const [companyAudience, pendingRequests, shareableMembers, activity] = await Promise.all([
    document.visibility === "COMPANY"
      ? prisma.productionMember.findMany({
          where: {
            status: "ACTIVE",
            user: { status: { not: "DISABLED" } },
            ...(document.productionId ? { productionId: document.productionId } : {}),
            role: { archived: false, categories: { some: { id: document.categoryId } } },
          },
          include: {
            user: { select: { name: true, email: true } },
            role: { select: { name: true } },
            production: { select: { name: true, slug: true } },
          },
          orderBy: [{ role: { sortOrder: "asc" } }, { createdAt: "asc" }],
        })
      : [],
    canEdit
      ? prisma.accessRequest.findMany({
          where: { documentId: document.id, status: "PENDING" },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [],
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
            {document.pinned && viewer.isBoard ? (
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

        {isCanva && document.canvaUrl ? (
          <a
            href={document.canvaUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary")}
          >
            <Icon name="canva" className="size-4" />
            Edit in Canva
          </a>
        ) : null}

        {formResponderUrl ? (
          <a
            href={formResponderUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary")}
            title="The link to send people. The button above opens the editor, where the questions can be changed."
          >
            <Icon name="form" className="size-4" />
            Open the form to fill in
          </a>
        ) : null}

        {(isUploaded || isCanva) && env.driveMode === "mock" && document.googleFileId ? (
          <a
            href={`/api/uploads/blob/${document.googleFileId}`}
            download={document.originalFileName ?? undefined}
            className={buttonClass("secondary")}
          >
            <Icon name="download" className="size-4" />
            Download
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
            {/* One "when did this last change", and for anything in Drive it
                is Google's answer rather than the hub's. */}
            <Row label="Last edited">
              <span title={formatDateTime(document.lastEditedAt)}>
                {relativeTime(document.lastEditedAt)}
                {document.googleModifiedAt ? (
                  <span className="text-ink-400"> · in Google</span>
                ) : null}
              </span>
            </Row>
            {isCanva ? (
              <Row label="Copy format">
                {CANVA_FORMAT_META[(document.canvaExportFormat ?? "pdf") as CanvaExportFormat]
                  ?.label ?? document.canvaExportFormat}
              </Row>
            ) : null}
            {isCanva && document.canvaExportedAt ? (
              <Row label="Copy taken">{relativeTime(document.canvaExportedAt)}</Row>
            ) : null}
            {isCanva && document.canvaDesignUpdatedAt ? (
              <Row label="Canva changed">{relativeTime(document.canvaDesignUpdatedAt)}</Row>
            ) : null}
            {document.sizeBytes ? (
              <Row label="Size">{formatBytes(document.sizeBytes)}</Row>
            ) : null}
            {document.originalFileName ? (
              <Row label="Uploaded as">{document.originalFileName}</Row>
            ) : null}
            {/* Where the file sits in the club's Drive, and who the hub last
                talked to about it, is housekeeping for the people who do the
                filing. Everyone else just opens the thing. */}
            {viewer.isBoard ? (
              <>
                <Row label="Hub record updated">{relativeTime(document.updatedAt)}</Row>
                {document.driveOwnerEmail ? (
                  <Row label="Drive owner">{document.driveOwnerEmail}</Row>
                ) : null}
                {document.googleFileId ? <Row label="Drive folder">{folderPath}</Row> : null}
                {document.lastSyncedAt ? (
                  <Row label="Last checked">{relativeTime(document.lastSyncedAt)}</Row>
                ) : null}
              </>
            ) : null}
          </dl>
        </Card>

        <Card>
          <SectionHeader
            icon={visibility?.icon ?? "users"}
            title="Who can see this"
            description={`${visibility?.label} · ${
              EDIT_ACCESS_META[clampEditAccess(document.visibility, document.editAccess)]?.label ??
              document.editAccess
            } can edit the file`}
          />

          {document.visibility === "COMPANY" ? (
            <div className="space-y-3 text-sm">
              <p className="text-ink-600">
                {viewer.isBoard ? "Everyone with hub access" : "The board"} can see this, plus{" "}
                <span className="font-medium text-ink-800">
                  {companyAudience.length}{" "}
                  {companyAudience.length === 1 ? "person" : "people"}
                </span>{" "}
                working on{" "}
                {document.production ? (
                  <Link
                    href={`/productions/${document.production.slug}/company`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {document.production.name}
                  </Link>
                ) : (
                  "a current production"
                )}
                .
              </p>

              {companyAudience.length > 0 ? (
                <ul className="max-h-56 space-y-1.5 overflow-y-auto scroll-slim">
                  {companyAudience.map((member) => (
                    <li
                      key={member.id}
                      className="flex items-center gap-2 rounded-lg bg-ink-50 p-2 text-sm"
                    >
                      <Avatar name={member.user.name} email={member.user.email} size={24} />
                      <span className="min-w-0 flex-1 truncate">
                        {member.user.name ?? member.user.email}
                        {member.title ? (
                          <span className="text-ink-500"> · {member.title}</span>
                        ) : null}
                      </span>
                      <Badge tone="green">{member.role?.name ?? "No role"}</Badge>
                    </li>
                  ))}
                </ul>
              ) : viewer.isBoard ? (
                <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  Nobody on the company has a role that covers {document.category.name} yet, so
                  right now this is only visible to the board.
                </p>
              ) : null}

              <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
                {viewer.isBoard
                  ? "In Google Drive each of them is added individually as a viewer — company members are not in the board group. Take someone off the show and their access disappears with them."
                  : "Everyone listed here is added to the file in Google Drive by name, so it opens for them with the account they sign in with. Access ends when the show does."}
              </div>
            </div>
          ) : document.visibility === "BOARD" ? (
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
                {viewer.isBoard
                  ? "This is private. It is hidden from every other member's dashboard and is not shared with the board group in Drive."
                  : "This is private. Only the people listed below can see it — not the rest of the company, and not the board."}
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

      {canEdit && pendingRequests.length > 0 ? (
        <Card className="border-amber-300">
          <SectionHeader
            icon="user-plus"
            title={`${pendingRequests.length} ${
              pendingRequests.length === 1 ? "person is" : "people are"
            } asking for access`}
            description="Granting adds them by name, here and in Drive."
          />
          <ul className="space-y-2">
            {pendingRequests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 p-2.5"
              >
                <Avatar name={request.user.name} email={request.user.email} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {request.user.name ?? request.user.email}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {request.message ?? request.user.email} · {relativeTime(request.createdAt)}
                  </span>
                </span>
                <form action={decideAccessRequestAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <input type="hidden" name="grant" value="true" />
                  <button type="submit" className={buttonClass("primary", "text-xs")}>
                    <Icon name="check" className="size-3.5" />
                    Grant
                  </button>
                </form>
                <form action={decideAccessRequestAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <input type="hidden" name="grant" value="false" />
                  <button type="submit" className={buttonClass("ghost", "text-xs")}>
                    Decline
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {isCanva ? (
        <Card className={canvaStale ? "border-amber-300" : undefined}>
          <SectionHeader
            icon="canva"
            title="Canva original"
            description={
              canEdit
                ? "Canva has no way to let the hub decide who opens a design, so the hub keeps an exported copy in Drive instead — and that copy follows this document's visibility. Canva stays where it is edited."
                : "What you open here is a copy of a Canva design, so it is only as new as the last time somebody exported it."
            }
          />

          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
              {document.canvaExportedAt ? (
                <>
                  The {CANVA_FORMAT_META[(document.canvaExportFormat ?? "pdf") as CanvaExportFormat]?.label ?? "copy"}{" "}
                  in Drive was taken {relativeTime(document.canvaExportedAt)}
                  {document.canvaDesignUpdatedAt ? (
                    <>
                      {" "}
                      and the design in Canva last changed{" "}
                      {relativeTime(document.canvaDesignUpdatedAt)}.
                    </>
                  ) : (
                    "."
                  )}{" "}
                  {canvaStale
                    ? canEdit
                      ? "Re-export to bring the copy up to date — same link, same sharing, and Drive keeps the old version."
                      : "So what you open may be out of date. Ask whoever filed it to re-export."
                    : "The copy is current."}
                </>
              ) : canEdit ? (
                "No copy has been exported yet, so nobody but the Canva editors can see this. Export one below."
              ) : (
                "No copy has been exported yet, so there is nothing to open here."
              )}
            </div>

            {/* Freshness is checked when the page opens, not just on a timer —
                see the action for why. Every viewer, because a cast member is
                exactly who should not be handed last week's poster. */}
            <CanvaWatch documentId={document.id} />

            {canEdit ? (
              <>
                <CanvaReexportForm documentId={document.id} stale={canvaStale} />
                <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                  <form action={checkCanvaFreshnessAction}>
                    <input type="hidden" name="id" value={document.id} />
                    <button type="submit" className={buttonClass("ghost")}>
                      <Icon name="clock" className="size-4" />
                      Check Canva for changes
                    </button>
                  </form>
                  {env.canvaMode === "mock" ? (
                    <form action={simulateCanvaEditAction}>
                      <input type="hidden" name="id" value={document.id} />
                      <button
                        type="submit"
                        className={buttonClass("ghost")}
                        title="Simulated Canva only — pretends somebody edited the design so you can see the out-of-date state"
                      >
                        <Icon name="sparkles" className="size-4" />
                        Simulate an edit in Canva
                      </button>
                    </form>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {canEdit && isUploaded ? (
        <Card>
          <SectionHeader
            icon="history"
            title="New version"
            description="Upload an updated file over this one instead of creating “v2”. Same link, same sharing — Drive keeps the old version."
          />
          <NewVersionUploader
            documentId={document.id}
            currentFileName={document.originalFileName}
          />
        </Card>
      ) : null}

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
