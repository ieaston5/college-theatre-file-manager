import { prisma } from "../db";
import { env } from "../env";
import { getConfig } from "../config";
import { canvaMirrorIsStale } from "../documents";
import { getViewerContext, visibleDocumentsWhere } from "../access";
import { sendEmail, weeklyDigest, type DigestData } from "./index";

/**
 * The weekly digest.
 *
 * The half that matters is not "here is what changed" — people saw that
 * happen. It is "here is what hasn't": categories that have gone quiet, a show
 * with nothing filed against it yet, a Canva copy that is behind the original,
 * people who were added and never signed in. That is the information a
 * production manager actually chases.
 *
 * Each person's digest is built through their own visibility, so nobody learns
 * about a document they could not otherwise see.
 */

const QUIET_DAYS = 14;

export async function buildDigestFor(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
}): Promise<DigestData | null> {
  const config = await getConfig();
  const viewer = await getViewerContext(user);
  const where = visibleDocumentsWhere(viewer);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const quietBefore = new Date(Date.now() - QUIET_DAYS * 24 * 60 * 60 * 1000);

  const [changedCount, changed, created, categories, canvaMirrors] = await Promise.all([
    prisma.document.count({ where: { ...where, status: "ACTIVE", updatedAt: { gte: since } } }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 14,
      include: {
        category: { select: { name: true } },
        production: { select: { name: true } },
      },
    }),
    // "of them new" has to be a subset of what changed, or the sentence reads
    // as nonsense when a document's updatedAt has been set behind its
    // createdAt (which seeded data does).
    prisma.document.count({
      where: {
        ...where,
        status: "ACTIVE",
        createdAt: { gte: since },
        updatedAt: { gte: since },
      },
    }),
    prisma.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, scope: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.document.findMany({
      where: { ...where, status: "ACTIVE", canvaDesignId: { not: null } },
      select: { title: true, canvaExportedAt: true, canvaDesignUpdatedAt: true },
    }),
  ]);

  // Categories the viewer can see that have had nothing new in a fortnight.
  const quietCategories: string[] = [];
  for (const category of categories) {
    if (!viewer.isBoard && !viewer.companyCategoryIds.includes(category.id)) continue;
    const latest = await prisma.document.findFirst({
      where: { ...where, status: "ACTIVE", categoryId: category.id },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    if (latest && latest.updatedAt < quietBefore) quietCategories.push(category.name);
  }

  // Board only: shows with production categories still empty.
  const emptyForProduction: DigestData["emptyForProduction"] = [];
  if (viewer.isBoard) {
    const shows = await prisma.production.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE"] } },
      select: { id: true, name: true },
    });
    for (const show of shows) {
      const used = await prisma.document.findMany({
        where: { productionId: show.id, status: "ACTIVE" },
        select: { categoryId: true },
        distinct: ["categoryId"],
      });
      const usedIds = new Set(used.map((row) => row.categoryId));
      const missing = categories
        .filter((category) => category.scope !== "STANDING" && !usedIds.has(category.id))
        .map((category) => category.name);
      if (missing.length > 0) {
        emptyForProduction.push({ production: show.name, categories: missing.slice(0, 5) });
      }
    }
  }

  const notSignedIn = viewer.isBoard
    ? await prisma.user.count({ where: { status: "INVITED" } })
    : 0;

  const staleCanva = canvaMirrors
    .filter((mirror) => canvaMirrorIsStale(mirror))
    .map((mirror) => mirror.title);

  // Nothing at all to say: skip rather than send an empty note.
  const worthSending =
    changedCount > 0 ||
    quietCategories.length > 0 ||
    emptyForProduction.length > 0 ||
    staleCanva.length > 0 ||
    notSignedIn > 0;
  if (!worthSending) return null;

  return {
    orgName: config.orgName,
    appUrl: env.appUrl,
    name: user.name,
    since,
    changedCount,
    changed: changed.map((document) => ({
      title: document.title,
      categoryName: document.category.name,
      productionName: document.production?.name ?? null,
    })),
    created,
    quietCategories,
    staleCanva,
    emptyForProduction,
    notSignedIn,
  };
}

export async function sendDigests(options?: { onlyTo?: string }): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const recipients = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      digestOptOut: false,
      ...(options?.onlyTo ? { email: options.onlyTo } : {}),
    },
    select: { id: true, email: true, name: true, role: true },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const data = await buildDigestFor(recipient);
    if (!data) {
      skipped += 1;
      continue;
    }
    const result = await sendEmail({
      to: recipient.email,
      message: weeklyDigest(data),
      respectOptOut: true,
      relatedId: recipient.id,
    });
    if (result.status === "FAILED") failed += 1;
    else if (result.status === "SKIPPED") skipped += 1;
    else sent += 1;
  }

  await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: { lastDigestAt: new Date() },
  });

  return { sent, skipped, failed };
}
