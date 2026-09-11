import { cache } from "react";
import { prisma } from "./db";
import { categoryFilterFor, visibleDocumentsWhere, type Viewer } from "./access";

/**
 * The shelf data every hub page draws: the categories in the sidebar and the
 * document tallies beside them.
 *
 * Rendering any page runs the app layout and the page itself in the same
 * request, and both wanted the same three things — the viewer's categories and
 * a count of visible documents per category and per production. That was six
 * queries where three will do, and on a hosted Postgres each one is a network
 * round trip before a single pixel is sent.
 *
 * These are memoised on the viewer object, which is safe because
 * getViewerContext is itself memoised per request: every caller within one
 * request is handed the same object, which is what React's cache() compares.
 */

export const visibleCategories = cache(async function visibleCategories(viewer: Viewer) {
  return prisma.category.findMany({
    where: categoryFilterFor(viewer),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});

/** How many active documents the viewer can see in each category, by category id. */
export const documentCountsByCategory = cache(async function documentCountsByCategory(
  viewer: Viewer,
) {
  const rows = await prisma.document.groupBy({
    by: ["categoryId"],
    where: { ...visibleDocumentsWhere(viewer), status: "ACTIVE" },
    _count: { _all: true },
    _max: { lastEditedAt: true },
  });
  return new Map(
    rows.map((row) => [row.categoryId, { count: row._count._all, updated: row._max.lastEditedAt }]),
  );
});

/**
 * The same, per production. Documents filed against no show are counted under
 * the empty string, matching what the callers already looked up.
 */
export const documentCountsByProduction = cache(async function documentCountsByProduction(
  viewer: Viewer,
) {
  const rows = await prisma.document.groupBy({
    by: ["productionId"],
    where: { ...visibleDocumentsWhere(viewer), status: "ACTIVE" },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.productionId ?? "", row._count._all]));
});
