import type { Prisma, User } from "@prisma/client";
import { atLeast } from "./constants";

type DocumentLike = {
  visibility: string;
  creatorId: string;
  shares?: Array<{ userId: string }>;
};

/**
 * The one place that decides who can see a document.
 *
 * PRIVATE means private, including from admins: a private document is only
 * ever listed for its creator and anyone they explicitly shared it with. That
 * is the promise the creation form makes, so nothing in the app may widen it.
 */
export function visibleDocumentsWhere(user: Pick<User, "id">): Prisma.DocumentWhereInput {
  return {
    OR: [
      { visibility: "BOARD" },
      { creatorId: user.id },
      { shares: { some: { userId: user.id } } },
    ],
  };
}

export function canViewDocument(user: Pick<User, "id" | "role">, doc: DocumentLike): boolean {
  if (doc.visibility === "BOARD") return true;
  if (doc.creatorId === user.id) return true;
  return Boolean(doc.shares?.some((share) => share.userId === user.id));
}

/** Creators own their documents; admins may curate anything shared with the board. */
export function canEditDocument(user: Pick<User, "id" | "role">, doc: DocumentLike): boolean {
  if (!canViewDocument(user, doc)) return false;
  if (doc.creatorId === user.id) return true;
  return doc.visibility === "BOARD" && atLeast(user.role, "ADMIN");
}

export function canDeleteDocument(user: Pick<User, "id" | "role">, doc: DocumentLike): boolean {
  return canEditDocument(user, doc);
}

export function canManageShares(user: Pick<User, "id" | "role">, doc: DocumentLike): boolean {
  return canEditDocument(user, doc);
}
