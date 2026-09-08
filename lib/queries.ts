import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { visibleDocumentsWhere, type Viewer } from "./access";
import { containsInsensitive, containsInsensitiveNullable } from "./db-portability";

export const DOCUMENT_LIST_INCLUDE = {
  category: { select: { name: true, slug: true, icon: true, color: true } },
  production: { select: { name: true, slug: true } },
  creator: { select: { name: true, email: true } },
  tags: { select: { name: true, slug: true } },
} satisfies Prisma.DocumentInclude;

export type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Text search across title, description, tags, production and category.
 * Case-insensitivity is handled in lib/db-portability so the behaviour is the
 * same on SQLite and Postgres.
 */
function searchWhere(term: string): Prisma.DocumentWhereInput {
  return {
    OR: [
      { title: containsInsensitive(term) },
      { description: containsInsensitiveNullable(term) },
      { tags: { some: { name: containsInsensitive(term) } } },
      { production: { name: containsInsensitive(term) } },
      { category: { name: containsInsensitive(term) } },
    ],
  };
}

export function buildDocumentWhere(
  viewer: Viewer,
  params: SearchParams,
  extra?: Prisma.DocumentWhereInput,
): Prisma.DocumentWhereInput {
  const clauses: Prisma.DocumentWhereInput[] = [visibleDocumentsWhere(viewer)];

  const term = one(params, "q")?.trim();
  if (term) clauses.push(searchWhere(term));

  const category = one(params, "category");
  if (category && category !== "all") clauses.push({ category: { slug: category } });

  const production = one(params, "production");
  if (production === "none") clauses.push({ productionId: null });
  else if (production && production !== "all") clauses.push({ production: { slug: production } });

  const type = one(params, "type");
  if (type && type !== "all") clauses.push({ docType: type });

  const visibility = one(params, "visibility");
  if (visibility && visibility !== "all") clauses.push({ visibility });

  if (one(params, "mine")) clauses.push({ creatorId: viewer.id });

  const status = one(params, "status");
  clauses.push({ status: status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE" });

  if (extra) clauses.push(extra);

  return { AND: clauses };
}

export function buildDocumentOrder(params: SearchParams): Prisma.DocumentOrderByWithRelationInput[] {
  switch (one(params, "sort")) {
    case "created":
      return [{ pinned: "desc" }, { createdAt: "desc" }];
    case "title":
      return [{ pinned: "desc" }, { title: "asc" }];
    default:
      return [{ pinned: "desc" }, { updatedAt: "desc" }];
  }
}

export async function queryDocuments(
  viewer: Viewer,
  params: SearchParams,
  options?: { extra?: Prisma.DocumentWhereInput; take?: number; skip?: number },
) {
  const where = buildDocumentWhere(viewer, params, options?.extra);
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: DOCUMENT_LIST_INCLUDE,
      orderBy: buildDocumentOrder(params),
      take: options?.take ?? 60,
      skip: options?.skip ?? 0,
    }),
    prisma.document.count({ where }),
  ]);
  return { documents, total };
}
