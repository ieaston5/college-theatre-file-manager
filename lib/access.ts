import { cache } from "react";
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
 *            A company document is always one show's document: somebody is in
 *            the company of a production, not of the hub, so a company
 *            document filed against no show — or against a show they are not
 *            on — is board-only as far as they are concerned.
 *   BOARD    everybody with board access to the hub. Company members never see
 *            these, whatever production they are on and whoever filed them —
 *            somebody who has come off the board keeps their private
 *            documents and loses the board's.
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
  /** Whether this role may file documents on the hub. */
  canCreate: boolean;
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
 *
 * Memoised on the three fields it reads rather than on the user object, so
 * that the layout and the page inside it share one lookup even when they got
 * their user row from different places. Keying on primitives is what makes
 * that work: React's cache() compares arguments by identity.
 */
const loadViewerContext = cache(async function loadViewerContext(
  id: string,
  email: string,
  role: string,
): Promise<Viewer> {
  const user = { id, email, role };
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
          canCreate: true,
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
    canCreate: Boolean(row.role && !row.role.archived && row.role.canCreate),
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
});

export function getViewerContext(user: Pick<User, "id" | "email" | "role">): Promise<Viewer> {
  return loadViewerContext(user.id, user.email, user.role);
}

/**
 * Whether this person may file anything at all. Board members always can;
 * a company member can only if one of their production roles says so.
 */
export function canCreateDocuments(viewer: Viewer): boolean {
  if (viewer.isBoard) return true;
  return viewer.memberships.some((membership) => membership.canCreate);
}

/** The productions a company creator may file against. */
export function creatableProductionIds(viewer: Viewer): string[] | null {
  if (viewer.isBoard) return null;
  return viewer.memberships
    .filter((membership) => membership.canCreate)
    .map((membership) => membership.productionId);
}

/** The categories a company creator may file into. */
export function creatableCategoryIds(viewer: Viewer): string[] | null {
  if (viewer.isBoard) return null;
  return [
    ...new Set(
      viewer.memberships
        .filter((membership) => membership.canCreate)
        .flatMap((membership) => membership.categoryIds),
    ),
  ];
}

/**
 * The visibilities somebody may choose. A company member can never publish to
 * the board — they cannot see board documents, so they must not be able to
 * make one.
 */
export function allowedVisibilitiesFor(
  viewer: Viewer,
  category: { companyVisible: boolean },
  options: { hasProduction: boolean },
): string[] {
  const byCategory = allowedVisibilities(category, options);
  if (viewer.isBoard) return byCategory;
  return byCategory.filter((visibility) => visibility !== "BOARD");
}

export function visibleDocumentsWhere(viewer: Viewer): Prisma.DocumentWhereInput {
  const clauses: Prisma.DocumentWhereInput[] = [
    // Filing something does not outlast board access: somebody whose term has
    // ended still owns their private documents, but the board paperwork they
    // wrote goes with the board. An explicit share is a decision somebody
    // made by hand, so it stands either way.
    viewer.isBoard
      ? { creatorId: viewer.id }
      : { creatorId: viewer.id, visibility: { not: "BOARD" } },
    { shares: { some: { userId: viewer.id } } },
  ];

  if (viewer.isBoard) {
    clauses.push({ visibility: { in: ["BOARD", "COMPANY"] } });
    return { OR: clauses };
  }

  // Company members: per production, only the categories their role covers.
  // Nothing else — a company document that is not filed against one of their
  // shows is not theirs, including one filed against no show at all. Somebody
  // is in the company of a production, so that is the only thing that can
  // carry company access to them.
  for (const membership of viewer.memberships) {
    if (membership.categoryIds.length === 0) continue;
    clauses.push({
      visibility: "COMPANY",
      productionId: membership.productionId,
      categoryId: { in: membership.categoryIds },
    });
  }

  return { OR: clauses };
}

export function canViewDocument(viewer: Viewer, doc: DocumentLike): boolean {
  if (doc.shares?.some((share) => share.userId === viewer.id)) return true;

  // Checked before ownership: a board document belongs to the board, so
  // somebody who has come off it stops seeing even the ones they filed.
  if (doc.visibility === "BOARD") return viewer.isBoard;

  if (doc.creatorId === viewer.id) return true;

  if (doc.visibility === "COMPANY") {
    if (viewer.isBoard) return true;
    // No show, no company: a company document reaches the people on the
    // production it is filed against, and nobody else.
    if (!doc.productionId) return false;
    const membership = viewer.memberships.find((item) => item.productionId === doc.productionId);
    return Boolean(membership?.categoryIds.includes(doc.categoryId));
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
 * out of the cast's view even by accident — and only for a document attached
 * to a show, because the show is what names the company it reaches.
 */
export function allowedVisibilities(
  category: { companyVisible: boolean },
  options: { hasProduction: boolean },
): string[] {
  return category.companyVisible && options.hasProduction
    ? ["PRIVATE", "COMPANY", "BOARD"]
    : ["PRIVATE", "BOARD"];
}

/**
 * Whether this person may change the file's *contents* in Google. Distinct
 * from canEditDocument, which is about the hub record.
 */
export function canEditFileContents(
  viewer: Viewer,
  doc: DocumentLike & { editAccess: string },
): boolean {
  if (!canViewDocument(viewer, doc)) return false;
  if (doc.creatorId === viewer.id) return true;
  if (doc.shares?.some((share) => share.userId === viewer.id)) {
    // A named share carries its own level, checked where it is applied.
    return true;
  }
  if (doc.editAccess === "CREATOR_ONLY") return false;
  if (doc.editAccess === "BOARD") return viewer.isBoard && viewer.role !== "MEMBER";
  return true;
}
