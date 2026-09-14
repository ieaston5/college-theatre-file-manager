import { prisma } from "./db";
import { visibleDocumentsWhere, type Viewer } from "./access";

/** A filing guide: counts shared files, never approvals or production tasks. */

export type ChecklistEntry = {
  id: string;
  label: string;
  hint: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  /** Ticked by hand. */
  done: boolean;
  /** Satisfied because something is filed in its category. */
  autoDone: boolean;
  documentCount: number;
};

/** Copy the template onto a production. Safe to call twice. */
export async function seedChecklistFor(productionId: string): Promise<number> {
  const [existing, template] = await Promise.all([
    prisma.checklistItem.count({ where: { productionId, categoryId: { not: null } } }),
    prisma.checklistTemplateItem.findMany({
      where: { archived: false, categoryId: { not: null } },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  if (existing > 0 || template.length === 0) return 0;

  await prisma.checklistItem.createMany({
    data: template.map((item) => ({
      productionId,
      label: item.label,
      categoryId: item.categoryId,
      hint: null,
      sortOrder: item.sortOrder,
    })),
  });
  return template.length;
}

export async function checklistFor(productionId: string, viewer: Viewer): Promise<ChecklistEntry[]> {
  const items = await prisma.checklistItem.findMany({
    where: { productionId, categoryId: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { id: true, name: true, slug: true } } },
  });
  if (items.length === 0) return [];

  // One grouped count covers every category-linked item.
  const counts = await prisma.document.groupBy({
    by: ["categoryId"],
    where: {
      AND: [visibleDocumentsWhere(viewer)],
      productionId,
      visibility: { not: "PRIVATE" },
      status: "ACTIVE",
      categoryId: {
        in: items.map((item) => item.categoryId).filter((id): id is string => Boolean(id)),
      },
    },
    _count: { _all: true },
  });
  const byCategory = new Map(counts.map((row) => [row.categoryId, row._count._all]));

  return items.map((item) => {
    const documentCount = item.categoryId ? (byCategory.get(item.categoryId) ?? 0) : 0;
    return {
      id: item.id,
      label: item.category?.name ?? item.label,
      hint: null,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      categorySlug: item.category?.slug ?? null,
      done: false,
      autoDone: documentCount > 0,
      documentCount,
    };
  });
}

export function checklistProgress(entries: ChecklistEntry[]) {
  const total = entries.length;
  const complete = entries.filter((entry) => entry.done || entry.autoDone).length;
  return { total, complete, percent: total === 0 ? 0 : Math.round((complete / total) * 100) };
}

/** The default template — theatre-shaped, and editable in Admin afterwards. */
export const DEFAULT_CHECKLIST: Array<{ label: string; categorySlug?: string; hint?: string }> = [
  { label: "Budget files", categorySlug: "budgets-finance" },
  { label: "Rehearsal calendars", categorySlug: "schedules-calendars" },
  { label: "Contact sheets", categorySlug: "contact-sheets" },
  { label: "Scripts and scores", categorySlug: "scripts-scores" },
  { label: "Design and tech files", categorySlug: "design-tech" },
  { label: "Costume and props files", categorySlug: "costumes-props" },
  { label: "Publicity files", categorySlug: "marketing-publicity" },
  { label: "Box office files", categorySlug: "box-office-house" },
];
