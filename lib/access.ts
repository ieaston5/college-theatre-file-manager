import type { Prisma, User } from "@prisma/client";
import { prisma } from "./db";
import { atLeast, isBoardRole } from "./constants";

/**
 * The one place that decides who can see what.
 *
 * Three visibility levels:
 *
 *   PRIVATE  the creator, plus anyone they added by hand. Private means
 *            private, including from admins — nothing in the app may widen it.
 *   COMPANY  the board, plus people working on that production whose
 *            production role covers the document's category. An actor sees the
 *            script and the schedule; they do not see the light plot unless
 *            their role says so, and they never see a category that has not
 *            been marked as company-visible at all.
 *   BOARD    everybody with board access to the hub. Company members never see
 *            these, whatever production they are on.
 *
 * Company access is computed from data (production membership → role →
 * categories) rather than hardcoded, so the board can change who sees what in
 * Admin without a deploy.
 */

export type ViewerMembership = {
  productionId: string;
  productionSlug: string;
  productionName: string;
  roleId: string | null;
  roleName: string | null;
  title: string | null;
  categoryIds: string[];
};

export type Viewer = {
  id: string;
  email: string;
  role: string;
  /** Board-side access (ADMIN, BOARD or MEMBER). */
  isBoard: boolean;
  isAdmin: boolean;
  memberships: ViewerMembership[];
  /** Union of the categories any of their memberships grants. */
  companyCategoryIds: string[];
};

type DocumentLike = {
  visibility: string;
  creatorId: string;
  categoryId: string;
  productionId?: string | null;
  shares?: Array<{ userId: string }>;
};

/**
 * Load everything needed to answer "can this person see that?" — one query
 * beyond the user row, and it is skipped entirely for people with no
 * production memberships.
 */
export async function getViewerContext(
  user: Pick<User, "id" | "email" | "role">,
): Promise<Viewer> {
  const rows = await prisma.productionMember.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      production: { status: { not: "ARCHIVED" } },
    },
    include: {
      production: { select: { id: true, slug: true, name: true } },
      role: {
        select: {
          id: true,
          name: true,
          archived: true,
          categories: { where: { archived: false, companyVisible: true }, select: { id: true } },
        },
      },
    },
  });

  const memberships: ViewerMembership[] = rows.map((row) => ({
    productionId: row.production.id,
    productionSlug: row.production.slug,
    productionName: row.production.name,
    roleId: row.role?.id ?? null,
    roleName: row.role?.name ?? null,
    title: row.title,
    // An archived role grants nothing — the safe direction.
    categoryIds: row.role && !row.role.archived ? row.role.categories.map((c) => c.id) : [],
  }));

  const companyCategoryIds = [
    ...new Set(memberships.flatMap((membership) => membership.categoryIds)),
  ];

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isBoard: isBoardRole(user.role),
    isAdmin: atLeast(user.role, "ADMIN"),
    memberships,
    companyCategoryIds,
  };
}

export function visibleDocumentsWhere(viewer: Viewer): Prisma.DocumentWhereInput {
  const clauses: Prisma.DocumentWhereInput[] = [
    { creatorId: viewer.id },
    { shares: { some: { userId: viewer.id } } },
  ];

  if (viewer.isBoard) {
    clauses.push({ visibility: { in: ["BOARD", "COMPANY"] } });
    return { OR: clauses };
  }

  // Company members: per production, only the categories their role covers.
  for (const membership of viewer.memberships) {
    if (membership.categoryIds.length === 0) continue;
    clauses.push({
      visibility: "COMPANY",
      productionId: membership.productionId,
      categoryId: { in: membership.categoryIds },
    });
  }
  // Organisation-wide company documents (handbooks, onboarding) are not tied
  // to a show, so any current membership is enough to reach them.
  if (viewer.companyCategoryIds.length > 0) {
    clauses.push({
      visibility: "COMPANY",
      productionId: null,
      categoryId: { in: viewer.companyCategoryIds },
    });
  }

  return { OR: clauses };
}

export function canViewDocument(viewer: Viewer, doc: DocumentLike): boolean {
  if (doc.creatorId === viewer.id) return true;
  if (doc.shares?.some((share) => share.userId === viewer.id)) return true;

  if (doc.visibility === "BOARD") return viewer.isBoard;

  if (doc.visibility === "COMPANY") {
    if (viewer.isBoard) return true;
    if (doc.productionId) {
      const membership = viewer.memberships.find(
        (item) => item.productionId === doc.productionId,
      );
      return Boolean(membership?.categoryIds.includes(doc.categoryId));
    }
    return viewer.companyCategoryIds.includes(doc.categoryId);
  }

  // PRIVATE, and neither creator nor an explicit share.
  return false;
}

/** Creators own their documents; admins may curate anything the board can see. */
export function canEditDocument(viewer: Viewer, doc: DocumentLike): boolean {
  if (!canViewDocument(viewer, doc)) return false;
  if (doc.creatorId === viewer.id) return true;
  return doc.visibility !== "PRIVATE" && viewer.isAdmin;
}

export function canDeleteDocument(viewer: Viewer, doc: DocumentLike): boolean {
  return canEditDocument(viewer, doc);
}

export function canManageShares(viewer: Viewer, doc: DocumentLike): boolean {
  return canEditDocument(viewer, doc);
}

// --- what shows up in the navigation ---------------------------------------

/** Category ids the viewer may browse, or null for "everything". */
export function visibleCategoryIds(viewer: Viewer): string[] | null {
  return viewer.isBoard ? null : viewer.companyCategoryIds;
}

/** Production ids the viewer may browse, or null for "everything". */
export function visibleProductionIds(viewer: Viewer): string[] | null {
  return viewer.isBoard ? null : viewer.memberships.map((membership) => membership.productionId);
}

export function categoryFilterFor(viewer: Viewer): Prisma.CategoryWhereInput {
  const ids = visibleCategoryIds(viewer);
  return ids === null ? { archived: false } : { archived: false, id: { in: ids } };
}

export function productionFilterFor(viewer: Viewer): Prisma.ProductionWhereInput {
  const ids = visibleProductionIds(viewer);
  return ids === null ? {} : { id: { in: ids } };
}

/**
 * Which visibility levels the creator may choose for a document in this
 * category. "Company" is only offered where the board has said the category is
 * safe for a company to see — that is the guard that keeps budgets and casting
 * out of the cast's view even by accident.
 */
export function allowedVisibilities(category: { companyVisible: boolean }): string[] {
  return category.companyVisible ? ["PRIVATE", "COMPANY", "BOARD"] : ["PRIVATE", "BOARD"];
}
