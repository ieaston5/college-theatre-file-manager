import Link from "next/link";
import type { Category, Document, Production, Tag, User } from "@prisma/client";
import { DOC_TYPE_META, VISIBILITY_META, type DocType, type Visibility } from "@/lib/constants";
import { cn, relativeTime } from "@/lib/utils";
import { canvaMirrorIsStale } from "@/lib/documents";
import { Icon } from "./icons";
import { Badge, EmptyState } from "./ui";

export type DocumentListItem = Document & {
  category: Pick<Category, "name" | "slug" | "icon" | "color">;
  production: Pick<Production, "name" | "slug"> | null;
  creator: Pick<User, "name" | "email">;
  tags?: Pick<Tag, "name" | "slug">[];
};

function typeMeta(docType: string) {
  return DOC_TYPE_META[(docType as DocType) in DOC_TYPE_META ? (docType as DocType) : "OTHER"];
}

export function DocTypeIcon({ docType, className }: { docType: string; className?: string }) {
  const meta = typeMeta(docType);
  return (
    <span
      className={cn("grid size-9 shrink-0 place-items-center rounded-lg", className)}
      style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
      title={meta.label}
    >
      <Icon name={meta.icon} className="size-4" />
    </span>
  );
}

export function DocumentRow({
  document,
  showCategory = true,
  showProduction = true,
}: {
  document: DocumentListItem;
  showCategory?: boolean;
  showProduction?: boolean;
}) {
  const visibility = VISIBILITY_META[document.visibility as Visibility];
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3 transition hover:bg-ink-50">
      <DocTypeIcon docType={document.docType} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/documents/${document.id}`}
            className="truncate text-sm font-medium text-ink-900 hover:text-brand-700"
          >
            {document.title}
          </Link>
          {document.pinned ? <Icon name="pin" className="size-3.5 shrink-0 text-gold-500" /> : null}
          {document.visibility === "PRIVATE" ? (
            <Icon name="lock" className="size-3.5 shrink-0 text-amber-600" title="Private" />
          ) : null}
          {document.status === "ARCHIVED" ? (
            <Badge tone="slate" className="shrink-0">
              Archived
            </Badge>
          ) : null}
          {canvaMirrorIsStale(document) ? (
            <Badge tone="amber" className="shrink-0" icon="alert">
              Canva newer
            </Badge>
          ) : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          {showCategory ? (
            <Link
              href={`/categories/${document.category.slug}`}
              className="inline-flex items-center gap-1 hover:text-ink-800"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: document.category.color }}
              />
              {document.category.name}
            </Link>
          ) : null}
          {showProduction && document.production ? (
            <>
              <span className="text-ink-300">·</span>
              <Link
                href={`/productions/${document.production.slug}`}
                className="inline-flex items-center gap-1 hover:text-ink-800"
              >
                <Icon name="theater" className="size-3" />
                {document.production.name}
              </Link>
            </>
          ) : null}
          <span className="text-ink-300">·</span>
          <span title={visibility?.label}>{typeMeta(document.docType).short}</span>
          <span className="text-ink-300">·</span>
          <span>updated {relativeTime(document.updatedAt)}</span>
          <span className="text-ink-300 max-sm:hidden">·</span>
          <span className="max-sm:hidden">{document.creator.name ?? document.creator.email}</span>
        </div>
      </div>

      {document.webViewLink ? (
        <a
          href={document.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg p-2 text-ink-400 opacity-0 transition hover:bg-white hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100"
          title="Open in Google"
          aria-label={`Open ${document.title} in Google`}
        >
          <Icon name="external" className="size-4" />
        </a>
      ) : null}
    </li>
  );
}

export function DocumentList({
  documents,
  showCategory = true,
  showProduction = true,
  empty,
}: {
  documents: DocumentListItem[];
  showCategory?: boolean;
  showProduction?: boolean;
  empty?: React.ReactNode;
}) {
  if (documents.length === 0) {
    return (
      <>
        {empty ?? (
          <EmptyState icon="folder" title="Nothing filed here yet">
            When someone creates a document from the hub it shows up here automatically.
          </EmptyState>
        )}
      </>
    );
  }

  return (
    <ul className="card divide-y divide-ink-100 overflow-hidden p-0">
      {documents.map((document) => (
        <DocumentRow
          key={document.id}
          document={document}
          showCategory={showCategory}
          showProduction={showProduction}
        />
      ))}
    </ul>
  );
}
