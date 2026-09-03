import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readMockFile, readMockState } from "@/lib/google/mock";
import { docTypeFromMime, DOC_TYPE_META } from "@/lib/constants";
import { Icon } from "@/components/icons";
import { Badge, Card, SectionHeader, buttonClass } from "@/components/ui";
import { formatBytes, formatDateTime } from "@/lib/utils";

/**
 * Stand-in for the Google Drive UI while the hub runs on a simulated Drive.
 * It exists so the sharing rules are actually visible during evaluation:
 * you can see exactly who a document was shared with, and that a private
 * document was not shared with the group.
 */
export default async function MockDriveFilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const file = readMockFile(id);
  if (!file) notFound();

  const state = readMockState();
  const docType = docTypeFromMime(file.mimeType);
  const meta = DOC_TYPE_META[docType];
  const isFolder = docType === "FOLDER";

  const children = isFolder
    ? Object.values(state.files).filter((entry) => !entry.trashed && entry.parents.includes(id))
    : [];

  const trail: Array<{ id: string; name: string }> = [];
  let cursor = file.parents[0];
  while (cursor && trail.length < 6) {
    const parent = state.files[cursor];
    if (!parent) break;
    trail.unshift({ id: parent.id, name: parent.name });
    cursor = parent.parents[0];
  }

  const hubDocument = file.appProperties?.hubDocumentId
    ? await prisma.document.findUnique({
        where: { id: file.appProperties.hubDocumentId },
        select: { id: true, title: true, visibility: true },
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <Icon name="cloud_off" className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">Simulated Google Drive</div>
            <p className="mt-0.5 leading-relaxed">
              This is not a real Google file. The hub is running with{" "}
              <code className="rounded bg-white/60 px-1">DRIVE_MODE=mock</code> so you can try the
              whole flow — including who a document gets shared with — before connecting a Google
              account. The owner would be{" "}
              <span className="font-medium">{state.accountEmail}</span>.
            </p>
          </div>
        </div>
      </div>

      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
        <Link href="/" className="hover:text-ink-800">
          Hub
        </Link>
        {trail.map((entry) => (
          <span key={entry.id} className="flex items-center gap-1.5">
            <Icon name="chevron-right" className="size-3" />
            <Link href={`/mock-drive/${entry.id}`} className="hover:text-ink-800">
              {entry.name}
            </Link>
          </span>
        ))}
      </nav>

      <div className="mb-6 flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
        >
          <Icon name={meta.icon} className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{file.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <Badge tone="slate">{meta.label}</Badge>
            <span>created {formatDateTime(new Date(file.createdTime))}</span>
            <span>·</span>
            <span>changed {formatDateTime(new Date(file.modifiedTime))}</span>
            {file.sizeBytes ? (
              <>
                <span>·</span>
                <span>{formatBytes(file.sizeBytes)}</span>
              </>
            ) : null}
            {file.revisions && file.revisions > 1 ? (
              <>
                <span>·</span>
                <Badge tone="slate">{file.revisions} versions</Badge>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {hubDocument ? (
          <Link href={`/documents/${hubDocument.id}`} className={buttonClass("secondary")}>
            <Icon name="external" className="size-4" />
            Open “{hubDocument.title}” on the hub
          </Link>
        ) : null}
        {file.blobFile ? (
          <a
            href={`/api/uploads/blob/${file.id}`}
            className={buttonClass("primary")}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="download" className="size-4" />
            Open the uploaded file
          </a>
        ) : null}
      </div>

      {file.headerPreview ? (
        <Card className="mb-4">
          <SectionHeader icon="doc" title="Document contents" description="What the hub wrote into the file." />
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-sm text-ink-700">
            {file.headerPreview}
          </pre>
        </Card>
      ) : null}

      <Card className="mb-4">
        <SectionHeader
          icon="users"
          title="Sharing"
          description="Exactly what the hub asked Google to do."
        />
        <ul className="space-y-2 text-sm">
          {file.permissions.map((permission) => (
            <li
              key={permission.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 px-3 py-2"
            >
              <Icon
                name={permission.type === "group" ? "users" : "mail"}
                className="size-4 text-ink-400"
              />
              <span className="min-w-0 flex-1 truncate font-medium text-ink-800">
                {permission.email}
              </span>
              <Badge tone={permission.role === "owner" ? "violet" : permission.role === "writer" ? "indigo" : "slate"}>
                {permission.role === "owner"
                  ? "Owner"
                  : permission.role === "writer"
                    ? "Can edit"
                    : "Can view"}
              </Badge>
              {permission.type === "group" ? <Badge tone="slate">Google Group</Badge> : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          There is no “anyone with the link” permission — the hub removes those on every sharing
          pass, so a hub document is never reachable by the wider internet.
        </p>
      </Card>

      {file.description ? (
        <Card className="mb-4">
          <SectionHeader icon="info" title="Drive description" />
          <p className="whitespace-pre-wrap text-sm text-ink-700">{file.description}</p>
        </Card>
      ) : null}

      {isFolder ? (
        <Card>
          <SectionHeader icon="folder-open" title={`${children.length} items in this folder`} />
          {children.length === 0 ? (
            <p className="text-sm text-ink-500">Empty.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {children.map((child) => {
                const childType = docTypeFromMime(child.mimeType);
                return (
                  <li key={child.id}>
                    <Link
                      href={`/mock-drive/${child.id}`}
                      className="flex items-center gap-2 py-2 text-sm hover:text-brand-700"
                    >
                      <Icon
                        name={DOC_TYPE_META[childType].icon}
                        className="size-4 shrink-0 text-ink-400"
                      />
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <span className="shrink-0 text-xs text-ink-400">
                        {DOC_TYPE_META[childType].short}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </main>
  );
}
