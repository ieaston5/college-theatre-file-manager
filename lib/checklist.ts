import { prisma } from "./db";

/**
 * Per-show checklists.
 *
 * The production page already listed categories with nothing filed in them,
 * which is a useful nag but not a plan: plenty of what a show needs is not a
 * document at all ("get the tech rider signed", "book the load-in"). So a
 * production carries a real list, copied from an admin-editable template when
 * the show is created.
 *
 * Items tied to a category complete themselves as soon as something is filed
 * there, because asking somebody to file a document *and* tick a box is how
 * checklists stop being trusted.
 */

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
    prisma.checklistItem.count({ where: { productionId } }),
    prisma.checklistTemplateItem.findMany({
      where: { archived: false },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  if (existing > 0 || template.length === 0) return 0;

  await prisma.checklistItem.createMany({
    data: template.map((item) => ({
      productionId,
      label: item.label,
      categoryId: item.categoryId,
      hint: item.hint,
      sortOrder: item.sortOrder,
    })),
  });
  return template.length;
}

export async function checklistFor(productionId: string): Promise<ChecklistEntry[]> {
  const items = await prisma.checklistItem.findMany({
    where: { productionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { id: true, name: true, slug: true } } },
  });
  if (items.length === 0) return [];

  // One grouped count covers every category-linked item.
  const counts = await prisma.document.groupBy({
    by: ["categoryId"],
    where: {
      productionId,
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
      label: item.label,
      hint: item.hint,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      categorySlug: item.category?.slug ?? null,
      done: item.done,
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
  { label: "Budget drafted and approved", categorySlug: "budgets-finance" },
  { label: "Rehearsal calendar published", categorySlug: "schedules-calendars" },
  { label: "Cast and crew contact sheet", categorySlug: "contact-sheets" },
  { label: "Script or score available to the company", categorySlug: "scripts-scores" },
  { label: "Design and tech paperwork", categorySlug: "design-tech" },
  { label: "Costume and props lists", categorySlug: "costumes-props" },
  { label: "Publicity plan", categorySlug: "marketing-publicity" },
  { label: "Box office and front of house plan", categorySlug: "box-office-house" },
  {
    label: "Venue booked and space request signed off",
    hint: "Not a document — tick it when the venue confirms.",
  },
  {
    label: "Company added to the hub",
    hint: "Cast and crew can reach the schedule and the script.",
  },
  { label: "Rights and licence confirmed", hint: "Before anything is printed or advertised." },
  { label: "Post-show: returns done and budget closed out" },
];
