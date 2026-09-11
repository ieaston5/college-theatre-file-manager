import type { Document, User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { getConfig, getDriveAccount } from "./config";
import { recordAudit } from "./audit";
import { driveProvider, resolveFolder } from "./google";
import type { DocHeader, SharingPlan, SharingResult } from "./google/types";
import {
  CANVA_FORMAT_META,
  DOC_TYPE_META,
  clampEditAccess,
  docTypeFromMime,
  type CanvaExportFormat,
  type CreatableDocType,
  type DocType,
  type Visibility,
} from "./constants";
import { canvaProvider, extractCanvaDesignId, getCanvaAccount } from "./canva";
// Re-exported so the existing callers keep working; anything that only needs
// the rule should import it straight from lib/canva/freshness.
export { canvaMirrorIsStale } from "./canva/freshness";
import { canCreateDocuments, type Viewer } from "./access";
import { putBytesToDrive } from "./google/upload";
import {
  applyNamingTemplate,
  driveViewLink,
  extractDriveFileId,
  parseTagInput,
  slugify,
  withExtension,
} from "./utils";

export type DocumentServiceResult = {
  document: Document;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** The bits of the org config the naming rule reads. */
export type NamingContext = {
  namingTemplate: string;
  currentSeason: string | null;
};

/**
 * The one name a document has.
 *
 * The hub used to keep two: the file in Drive was named by the admin's rule
 * ("[URINETOWN] Running budget — Budgets & finance") while the hub listed
 * whatever the person typed ("Running budget"). Two names for one thing is a
 * small lie that costs real time — you cannot tell from a hub list what a file
 * is called in Drive, and a list of twenty bare titles tells you nothing about
 * which show or shelf each belongs to.
 *
 * So the rule composes the hub title too, from `baseTitle`. Composing always
 * from the base is what keeps it idempotent: re-filing a document to another
 * show, or an admin editing the rule, recomposes the name rather than
 * prefixing the prefixed thing again.
 */
export function documentName(
  config: NamingContext,
  input: {
    baseTitle: string;
    category: { name: string } | null | undefined;
    production?: { name: string; abbreviation: string | null; season: string | null } | null;
  },
): string {
  return applyNamingTemplate(config.namingTemplate, {
    production: input.production?.abbreviation || input.production?.name || null,
    category: input.category?.name,
    title: input.baseTitle,
    season: input.production?.season ?? config.currentSeason,
  });
}

/** Find-or-create Tag rows for a comma-separated tag string. */
async function tagIds(input: string | undefined): Promise<Array<{ id: string }>> {
  const names = parseTagInput(input);
  if (names.length === 0) return [];
  const tags = await Promise.all(
    names.map((name) =>
      prisma.tag.upsert({
        where: { slug: slugify(name) },
        create: { name, slug: slugify(name) },
        update: {},
      }),
    ),
  );
  return tags.map((tag) => ({ id: tag.id }));
}

/**
 * Everyone on a production whose role covers this category. This is what turns
 * "the company can see the script" into actual Drive permissions — company
 * members are not in the board's Google Group, so they are shared with by
 * name, as viewers.
 */
async function companyRecipients(doc: {
  visibility: string;
  categoryId: string;
  productionId?: string | null;
}): Promise<string[]> {
  if (doc.visibility !== "COMPANY") return [];
  // No show, no company. A document filed against no production has no company
  // to belong to, so nobody outside the board reaches it — and returning
  // nobody here is what makes a reconciling sync take the grants back off one
  // that was shared more widely before the rule changed.
  if (!doc.productionId) return [];

  const members = await prisma.productionMember.findMany({
    where: {
      status: "ACTIVE",
      user: { status: { not: "DISABLED" } },
      // An archived show ends its company's access. getViewerContext already
      // ignores archived productions, so without this Drive would keep
      // granting access the hub had stopped showing.
      production: { status: { not: "ARCHIVED" } },
      productionId: doc.productionId,
      role: { archived: false, categories: { some: { id: doc.categoryId } } },
    },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(members.map((member) => member.user.email))];
}

/**
 * "Company" is only available where an admin has opened the category up to
 * companies, and only for a document attached to a show — the show is the
 * company. Enforced here as well as in the form, so an old page or a hand made
 * request cannot put a budget in front of the cast, or file something as
 * "Company" that no company can actually see.
 */
function assertVisibilityAllowed(
  category: { name: string; companyVisible: boolean },
  visibility: string,
  hasProduction: boolean,
) {
  if (visibility !== "COMPANY") return;
  if (!category.companyVisible) {
    throw new Error(
      `${category.name} is not shared with production companies. Pick Board or Private — or ask an admin to open the category up to companies.`,
    );
  }
  if (!hasProduction) {
    throw new Error(
      `“Company” means the people on one show, so a company document has to be attached to a production. Attach it to a show, or file it for the board.`,
    );
  }
}

/**
 * A company member who is allowed to file may only do so inside the envelope
 * their role gives them: their own categories, their own shows, and never at
 * board visibility — they cannot see board documents, so they must not be able
 * to make one. Checked here as well as in the form.
 */
export function assertCreationAllowed(
  viewer: Viewer,
  input: { categoryId: string; productionId?: string | null; visibility: string },
) {
  if (viewer.isBoard) return;
  if (!canCreateDocuments(viewer)) {
    throw new Error("Your role on this show does not allow filing documents on the hub.");
  }
  if (input.visibility === "BOARD") {
    throw new Error("Only board members can file a document for the board.");
  }

  const membership = viewer.memberships.find(
    (entry) => entry.canCreate && entry.productionId === input.productionId,
  );
  // Filing against no show at all is still allowed for something they keep to
  // themselves; "Company" is refused by assertVisibilityAllowed, because
  // without a show there is no company for it to reach.
  const orgWideAllowed =
    !input.productionId &&
    viewer.memberships.some(
      (entry) => entry.canCreate && entry.categoryIds.includes(input.categoryId),
    );

  if (!membership && !orgWideAllowed) {
    throw new Error("You can only file documents for a show you are working on.");
  }
  if (membership && !membership.categoryIds.includes(input.categoryId)) {
    throw new Error("Your role on this show does not cover that category.");
  }
}

type SharableDocument = Pick<
  Document,
  "id" | "visibility" | "source" | "creatorId" | "categoryId" | "productionId" | "editAccess"
>;

/**
 * Every board member who should be able to reach a document — the member list
 * is the access list. The hub cannot read a consumer Google Group's
 * membership, so sharing board documents with the group meant "disable this
 * member" left their Drive access untouched. Naming everybody costs one Drive
 * permission per person per file, and in exchange offboarding is real.
 */
async function boardRecipients(
  boardCanEdit: boolean,
): Promise<Array<{ email: string; level: "READER" | "WRITER" }>> {
  const members = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: { not: "DISABLED" } },
    select: { email: true, role: true },
  });
  return members.map((member) => ({
    email: member.email,
    // A hub MEMBER is read-only, so they must not get Drive edit access even
    // when the board as a whole can edit.
    level: member.role === "MEMBER" || !boardCanEdit ? "READER" : "WRITER",
  }));
}

async function sharingPlanFor(doc: SharableDocument): Promise<SharingPlan> {
  const config = await getConfig();

  // Edit access is the narrower ladder: who can change the file's contents, as
  // opposed to who can see it. Clamped to visibility so it can never exceed it.
  const editAccess = clampEditAccess(doc.visibility, doc.editAccess);
  const boardCanEdit = editAccess === "BOARD" || editAccess === "COMPANY";
  const companyCanEdit = editAccess === "COMPANY";

  const [creator, shares, company, board] = await Promise.all([
    prisma.user.findUnique({ where: { id: doc.creatorId } }),
    prisma.documentShare.findMany({ where: { documentId: doc.id }, include: { user: true } }),
    companyRecipients(doc),
    doc.visibility === "PRIVATE" ? Promise.resolve([]) : boardRecipients(boardCanEdit),
  ]);

  const extra = shares.map((share) => ({
    email: share.user.email,
    level: share.accessLevel as "READER" | "WRITER",
  }));

  const seen = new Set(extra.map((entry) => entry.email.toLowerCase()));
  const add = (email: string, level: "READER" | "WRITER") => {
    if (seen.has(email.toLowerCase())) return;
    seen.add(email.toLowerCase());
    extra.push({ email, level });
  };

  // The board first: they can see everything that is not private, at the level
  // their hub role allows.
  for (const member of board) add(member.email, member.level);
  // Then the company, who read unless the document says everyone who can see
  // it may edit it.
  for (const email of company) add(email, companyCanEdit ? "WRITER" : "READER");

  return {
    visibility: doc.visibility as Visibility,
    creatorEmail: creator?.email ?? "",
    // Never granted — passed so a pass over a file left over from group
    // sharing takes that permission off it. Harmless on a file that never had
    // one.
    retireGroupEmail: config.groupEmail,
    extra,
    // Anything the hub made in its own Drive — created, uploaded or mirrored
    // from Canva — is reconciled, so dropping a document's visibility actually
    // removes the wider access. Only pre-existing files that belong to
    // somebody else are treated additively, where blindly revoking unknown
    // permissions would cut off their real collaborators.
    strategy: doc.source === "REGISTERED" ? "additive" : "reconcile",
  };
}

/** Push a document's visibility + share list into Drive. */
export async function syncSharing(
  doc: SharableDocument & Pick<Document, "googleFileId" | "docType">,
): Promise<SharingResult> {
  if (!doc.googleFileId || doc.docType === "LINK") {
    return { granted: [], revoked: [], warnings: [] };
  }
  const plan = await sharingPlanFor(doc);
  if (!plan.creatorEmail) {
    return { granted: [], revoked: [], warnings: ["Could not find the creator's email address."] };
  }
  const result = await driveProvider().applySharing(doc.googleFileId, plan);
  await prisma.document
    .update({ where: { id: doc.id }, data: { sharingSyncedAt: new Date() } })
    .catch(() => {});

  // Keep the recorded permission ids in step with Drive.
  for (const grant of result.granted) {
    await prisma.documentShare
      .updateMany({
        where: { documentId: doc.id, user: { email: grant.email } },
        data: { drivePermId: grant.permissionId },
      })
      .catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDocument(
  actor: User,
  input: {
    title: string;
    description?: string;
    docType: CreatableDocType;
    categoryId: string;
    productionId?: string;
    visibility: Visibility;
    editAccess?: string;
    templateId?: string;
    tags?: string;
  },
): Promise<DocumentServiceResult> {
  const [config, category, production, template] = await Promise.all([
    getConfig(),
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.productionId
      ? prisma.production.findUnique({ where: { id: input.productionId } })
      : Promise.resolve(null),
    input.templateId
      ? prisma.template.findUnique({ where: { id: input.templateId } })
      : Promise.resolve(null),
  ]);

  if (!category) throw new Error("That category no longer exists.");
  if (category.scope === "PRODUCTION" && !production) {
    throw new Error(`Documents in ${category.name} have to be attached to a production.`);
  }
  if (category.scope === "STANDING" && production) {
    throw new Error(`${category.name} is an organisation-wide category — leave the production blank.`);
  }
  if (input.productionId && !production) throw new Error("That production no longer exists.");
  assertVisibilityAllowed(category, input.visibility, Boolean(production));

  const warnings: string[] = [];

  // The same string names the file in Drive and the document on the hub.
  const name = documentName(config, {
    baseTitle: input.title,
    category,
    production,
  });

  // 1. Reserve the hub record first so the Drive file can link back to it.
  const record = await prisma.document.create({
    data: {
      title: name,
      baseTitle: input.title,
      description: input.description ?? null,
      docType: input.docType,
      source: "CREATED",
      visibility: input.visibility,
      editAccess: clampEditAccess(
        input.visibility,
        input.editAccess ?? category.defaultEditAccess,
      ),
      categoryId: category.id,
      productionId: production?.id ?? null,
      creatorId: actor.id,
      tags: { connect: await tagIds(input.tags) },
      metadata: JSON.stringify({
        createdVia: "hub",
        templateId: template?.id ?? null,
        driveMode: env.driveMode,
      }),
    },
  });

  try {
    const folderId = await resolveFolder({ category, production });

    const header: DocHeader | null = config.stampDocHeader
      ? {
          title: name,
          production: production?.name ?? null,
          category: category.name,
          owner: actor.name || actor.email,
          visibility: input.visibility,
          createdAt: new Date(),
          hubUrl: `${env.appUrl.replace(/\/$/, "")}/documents/${record.id}`,
          orgName: config.orgName,
        }
      : null;

    const file = await driveProvider().createDocument({
      name,
      docType: input.docType,
      parentFolderId: folderId,
      templateFileId: template?.googleFileId ?? null,
      description: [
        input.description,
        `${config.orgName} Hub · ${category.name}${production ? ` · ${production.name}` : ""}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      appProperties: {
        hubDocumentId: record.id,
        hubCategory: category.slug,
        hubProduction: production?.slug ?? "",
        hubVisibility: input.visibility,
      },
      header,
    });

    const updated = await prisma.document.update({
      where: { id: record.id },
      data: {
        googleFileId: file.id,
        webViewLink: file.webViewLink || driveViewLink(file.id, input.docType),
        driveFolderId: folderId,
        driveOwnerEmail: file.ownerEmail ?? null,
        googleModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
        lastEditedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
        lastSyncedAt: new Date(),
        // A form has two links and they must not be confused: the edit link
        // lets someone change the questions, the responder link is the one to
        // circulate. Kept in metadata rather than a column, so the same
        // document row shape serves every type.
        ...(file.formResponderUrl
          ? {
              metadata: JSON.stringify({
                createdVia: "hub",
                templateId: template?.id ?? null,
                driveMode: env.driveMode,
                formResponderUrl: file.formResponderUrl,
              }),
            }
          : {}),
      },
    });

    const sharing = await syncSharing(updated);
    warnings.push(...sharing.warnings);

    await recordAudit({
      actor,
      action: "document.create",
      targetType: "Document",
      targetId: updated.id,
      summary:
        input.visibility === "PRIVATE"
          ? `Created a private ${DOC_TYPE_META[input.docType].short.toLowerCase()} in ${category.name}`
          : `Created “${name}” in ${category.name}${production ? ` for ${production.name}` : ""}`,
      metadata: { docType: input.docType, visibility: input.visibility, fileName: name },
    });

    return { document: updated, warnings };
  } catch (error) {
    // Don't leave a phantom row behind if Drive refused.
    await prisma.document.delete({ where: { id: record.id } }).catch(() => {});
    throw error;
  }
}

/**
 * Re-push sharing for everything a production's company can see. Called when
 * somebody joins or leaves a production, or when a role's categories change —
 * without this, a new cast member would be on the hub but locked out of the
 * files in Drive.
 *
 * Documents filed against no show are included even though no company can see
 * them: a company document needs a production, so anything left over from
 * before that rule has Drive grants to hand back, and the reconciling sync is
 * what takes them off.
 */
export async function resyncCompanySharing(options: {
  productionId?: string;
}): Promise<{ total: number; failures: number }> {
  const documents = await prisma.document.findMany({
    where: {
      visibility: "COMPANY",
      status: "ACTIVE",
      googleFileId: { not: null },
      ...(options.productionId
        ? { OR: [{ productionId: options.productionId }, { productionId: null }] }
        : {}),
    },
    select: {
      id: true,
      visibility: true,
      source: true,
      creatorId: true,
      categoryId: true,
      productionId: true,
      editAccess: true,
      googleFileId: true,
      docType: true,
    },
    take: 500,
  });

  let failures = 0;
  for (const document of documents) {
    try {
      await syncSharing(document);
    } catch (error) {
      failures += 1;
      console.error("[sharing] could not resync", document.id, error);
    }
  }
  return { total: documents.length, failures };
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * The Drive file already exists (the browser sent the bytes straight to
 * Google); this records it on the hub and shares it. Same categories, same
 * naming rule, same visibility rules as anything created here — an uploaded
 * script is a first-class hub document, not an attachment.
 */
export async function recordUploadedDocument(
  actor: User,
  input: {
    title: string;
    description?: string;
    categoryId: string;
    productionId?: string;
    visibility: Visibility;
    editAccess?: string;
    tags?: string;
    originalFileName: string;
    driveFolderId: string | null;
    file: {
      id: string;
      name: string;
      mimeType: string;
      webViewLink: string;
      sizeBytes?: number | null;
      ownerEmail?: string | null;
      modifiedTime?: string | null;
    };
  },
): Promise<DocumentServiceResult> {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new Error("That category no longer exists.");
  const production = input.productionId
    ? await prisma.production.findUnique({ where: { id: input.productionId } })
    : null;
  assertVisibilityAllowed(category, input.visibility, Boolean(production));

  const docType = docTypeFromMime(input.file.mimeType);
  const warnings: string[] = [];
  const config = await getConfig();

  const document = await prisma.document.create({
    data: {
      // The extension belongs on the file in Drive, not on the title.
      title: documentName(config, { baseTitle: input.title, category, production }),
      baseTitle: input.title,
      description: input.description ?? null,
      docType,
      source: "CREATED",
      visibility: input.visibility,
      editAccess: clampEditAccess(input.visibility, input.editAccess ?? category.defaultEditAccess),
      categoryId: category.id,
      productionId: production?.id ?? null,
      creatorId: actor.id,
      googleFileId: input.file.id,
      webViewLink: input.file.webViewLink || driveViewLink(input.file.id, docType),
      driveFolderId: input.driveFolderId,
      driveOwnerEmail: input.file.ownerEmail ?? null,
      sizeBytes: input.file.sizeBytes ?? null,
      originalFileName: input.originalFileName,
      mimeType: input.file.mimeType,
      googleModifiedAt: input.file.modifiedTime ? new Date(input.file.modifiedTime) : new Date(),
      lastEditedAt: input.file.modifiedTime ? new Date(input.file.modifiedTime) : new Date(),
      lastSyncedAt: new Date(),
      tags: { connect: await tagIds(input.tags) },
      metadata: JSON.stringify({
        createdVia: "upload",
        driveMode: env.driveMode,
        driveName: input.file.name,
      }),
    },
  });

  // The upload session was opened before this row existed, so the file's
  // labels are missing the one that matters most for a rebuild: its hub id.
  try {
    await driveProvider().setAppProperties(input.file.id, { hubDocumentId: document.id });
  } catch (error) {
    console.error("[documents] could not label the uploaded file", error);
  }

  const sharing = await syncSharing(document);
  warnings.push(...sharing.warnings);

  await recordAudit({
    actor,
    action: "document.upload",
    targetType: "Document",
    targetId: document.id,
    summary:
      input.visibility === "PRIVATE"
        ? `Uploaded a private file to ${category.name}`
        : `Uploaded “${document.title}” to ${category.name}${production ? ` for ${production.name}` : ""}`,
    metadata: { docType, sizeBytes: input.file.sizeBytes ?? null, originalFileName: input.originalFileName },
  });

  return { document, warnings };
}

/**
 * A new version of an uploaded file: same Drive file id, so every link that
 * has already been shared keeps working and Drive keeps the old revision.
 * This is the answer to "Script_FINAL_v3.pdf".
 */
export async function recordNewVersion(
  actor: User,
  documentId: string,
  file: { mimeType: string; sizeBytes?: number | null; modifiedTime?: string | null },
  originalFileName: string,
): Promise<Document> {
  const document = await prisma.document.update({
    where: { id: documentId },
    data: {
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes ?? null,
      originalFileName,
      docType: docTypeFromMime(file.mimeType),
      googleModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
      lastEditedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
      lastSyncedAt: new Date(),
      status: "ACTIVE",
    },
  });

  await recordAudit({
    actor,
    action: "document.version",
    targetType: "Document",
    targetId: document.id,
    summary:
      document.visibility === "PRIVATE"
        ? "Uploaded a new version of a private file"
        : `Uploaded a new version of “${document.title}”`,
    metadata: { originalFileName, sizeBytes: file.sizeBytes ?? null },
  });

  return document;
}

/**
 * Re-share a chunk of documents, resumably.
 *
 * Per-member sharing turns one permission per file into one per person per
 * file, so re-sharing a season's worth of documents is hundreds of Google
 * calls — far more than a single request should attempt. This does a bounded
 * slice and reports what is left, so the caller can keep going until done and
 * nothing times out half-way.
 */
export async function runSharingSweep(options?: { chunk?: number }): Promise<{
  processed: number;
  remaining: number;
  total: number;
  failures: number;
}> {
  const chunk = options?.chunk ?? 12;
  const config = await getConfig();

  const startedAt =
    config.sharingSweepStartedAt ??
    (await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { sharingSweepStartedAt: new Date() },
    })).sharingSweepStartedAt!;

  const scope = {
    status: "ACTIVE" as const,
    googleFileId: { not: null },
    visibility: { not: "PRIVATE" as const },
  };
  const staleWhere = {
    ...scope,
    OR: [{ sharingSyncedAt: null }, { sharingSyncedAt: { lt: startedAt } }],
  };

  const [total, batch] = await Promise.all([
    prisma.document.count({ where: scope }),
    prisma.document.findMany({
      where: staleWhere,
      select: {
        id: true,
        visibility: true,
        source: true,
        creatorId: true,
        categoryId: true,
        productionId: true,
        editAccess: true,
        googleFileId: true,
        docType: true,
      },
      take: chunk,
    }),
  ]);

  let failures = 0;
  for (const document of batch) {
    try {
      await syncSharing(document);
    } catch (error) {
      failures += 1;
      console.error("[sharing] sweep failed for", document.id, error);
      // Mark it done anyway so one broken file cannot stall the sweep.
      await prisma.document
        .update({ where: { id: document.id }, data: { sharingSyncedAt: new Date() } })
        .catch(() => {});
    }
  }

  const remaining = await prisma.document.count({ where: staleWhere });
  if (remaining === 0) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { sharingSweepStartedAt: null },
    });
  }

  return { processed: batch.length, remaining, total, failures };
}

/** How many documents are waiting on the current sweep, if one is running. */
export async function sharingSweepStatus() {
  const config = await getConfig();
  if (!config.sharingSweepStartedAt) return { running: false, remaining: 0, total: 0 };
  const scope = {
    status: "ACTIVE" as const,
    googleFileId: { not: null },
    visibility: { not: "PRIVATE" as const },
  };
  const [remaining, total] = await Promise.all([
    prisma.document.count({
      where: {
        ...scope,
        OR: [{ sharingSyncedAt: null }, { sharingSyncedAt: { lt: config.sharingSweepStartedAt } }],
      },
    }),
    prisma.document.count({ where: scope }),
  ]);
  return { running: true, remaining, total };
}

// ---------------------------------------------------------------------------
// Canva mirrors
// ---------------------------------------------------------------------------

/**
 * Canva designs cannot be access-controlled through Canva's API — there is no
 * design-permission endpoint, and the URLs the API returns are single-user and
 * expire after 30 days. So a Canva design is *mirrored*: the hub exports it and
 * files the export in Drive, where Private / Company / Board already works.
 * Canva stays the place the design is edited; the hub owns the copy people read.
 */
export async function mirrorCanvaDesign(
  actor: User,
  input: {
    link: string;
    title?: string;
    description?: string;
    categoryId: string;
    productionId?: string;
    visibility: Visibility;
    editAccess?: string;
    tags?: string;
    format: CanvaExportFormat;
  },
): Promise<DocumentServiceResult> {
  const designId = extractCanvaDesignId(input.link);
  if (!designId) {
    throw new Error(
      "That does not look like a Canva link. Use the design's URL, e.g. https://www.canva.com/design/DAF…/view",
    );
  }

  const [config, category, production] = await Promise.all([
    getConfig(),
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.productionId
      ? prisma.production.findUnique({ where: { id: input.productionId } })
      : Promise.resolve(null),
  ]);
  if (!category) throw new Error("That category no longer exists.");
  if (category.scope === "PRODUCTION" && !production) {
    throw new Error(`Documents in ${category.name} have to be attached to a production.`);
  }
  if (category.scope === "STANDING" && production) {
    throw new Error(`${category.name} is an organisation-wide category — leave the production blank.`);
  }
  assertVisibilityAllowed(category, input.visibility, Boolean(production));

  const existing = await prisma.document.findFirst({ where: { canvaDesignId: designId } });
  if (existing) {
    throw new Error(
      `That Canva design is already on the hub as “${existing.title}”. Re-export it from there instead of adding it twice.`,
    );
  }

  const provider = canvaProvider();
  const design = await provider.getDesign(designId);
  if (!design) {
    const account = await getCanvaAccount();
    throw new Error(
      `The hub's Canva account${account?.displayName ? ` (${account.displayName})` : ""} cannot open that design. Share it with that account in Canva, then try again.`,
    );
  }

  const baseTitle = (input.title?.trim() || design.title || "Canva design").slice(0, 160);
  const warnings: string[] = [];

  const document = await prisma.document.create({
    data: {
      title: documentName(config, { baseTitle, category, production }),
      baseTitle,
      description: input.description ?? null,
      docType: "CANVA",
      source: "CANVA",
      visibility: input.visibility,
      editAccess: clampEditAccess(input.visibility, input.editAccess ?? category.defaultEditAccess),
      categoryId: category.id,
      productionId: production?.id ?? null,
      creatorId: actor.id,
      canvaDesignId: design.id,
      canvaUrl: design.url,
      canvaTitle: design.title,
      canvaExportFormat: input.format,
      canvaDesignUpdatedAt: design.updatedAt,
      canvaCheckedAt: new Date(),
      tags: { connect: await tagIds(input.tags) },
      metadata: JSON.stringify({
        createdVia: "canva-mirror",
        canvaMode: env.canvaMode,
        driveMode: env.driveMode,
        designTypes: design.designTypes,
        pageCount: design.pageCount,
      }),
    },
  });

  try {
    const exported = await exportCanvaMirror(actor, document.id, { silent: true });
    warnings.push(...exported.warnings);
  } catch (error) {
    // The record is still useful — it has the link and the metadata — so keep
    // it and tell the person the copy is missing.
    warnings.push(
      `The design is on the hub, but the first export failed: ${(error as Error).message}`,
    );
  }

  await recordAudit({
    actor,
    action: "canva.mirror",
    targetType: "Document",
    targetId: document.id,
    summary:
      input.visibility === "PRIVATE"
        ? `Mirrored a private Canva design into ${category.name}`
        : `Mirrored the Canva design “${document.title}” into ${category.name}${production ? ` for ${production.name}` : ""}`,
    metadata: { designId: design.id, format: input.format },
  });

  const fresh = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
  return { document: fresh, warnings };
}

/**
 * Export the Canva design and put the result in Drive. The first export
 * creates the Drive file; later ones replace its contents, so the link and the
 * sharing never change and Drive keeps the previous version.
 */
export async function exportCanvaMirror(
  actor: User,
  documentId: string,
  options?: { silent?: boolean },
): Promise<{ document: Document; warnings: string[] }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { category: true, production: true },
  });
  if (!document) throw new Error("That document no longer exists.");
  if (!document.canvaDesignId) throw new Error("That document is not a Canva mirror.");

  const config = await getConfig();
  const format = (document.canvaExportFormat ?? "pdf") as CanvaExportFormat;
  const warnings: string[] = [];

  const provider = canvaProvider();
  const design = await provider.getDesign(document.canvaDesignId);
  const exported = await provider.exportDesign(document.canvaDesignId, format);
  if (exported.note) warnings.push(exported.note);
  if (exported.extraFileCount > 0) {
    warnings.push(
      `Canva split that export into ${exported.extraFileCount + 1} files; the hub kept the first. Export as PDF to get one file.`,
    );
  }

  const meta = CANVA_FORMAT_META[exported.format];
  const driveName = withExtension(
    documentName(config, {
      baseTitle: document.baseTitle,
      category: document.category,
      production: document.production,
    }),
    meta.extension,
  );

  const folderId =
    document.driveFolderId ??
    (await resolveFolder({ category: document.category, production: document.production }));

  const file = await putBytesToDrive({
    fileId: document.googleFileId,
    name: driveName,
    mimeType: meta.mimeType,
    parentFolderId: folderId,
    description: [
      document.description,
      `${config.orgName} Hub · ${document.category.name}`,
      `Exported from Canva — edit the original at ${document.canvaUrl}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    appProperties: {
      hubDocumentId: document.id,
      hubCategory: document.category.slug,
      hubProduction: document.production?.slug ?? "",
      hubVisibility: document.visibility,
      hubCanvaDesignId: document.canvaDesignId,
    },
    bytes: exported.bytes,
  });

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      googleFileId: file.id,
      webViewLink: file.webViewLink || driveViewLink(file.id, "PDF"),
      driveFolderId: folderId,
      driveOwnerEmail: file.ownerEmail ?? document.driveOwnerEmail,
      mimeType: meta.mimeType,
      sizeBytes: exported.bytes.byteLength,
      originalFileName: driveName,
      canvaExportFormat: exported.format,
      canvaExportedAt: new Date(),
      canvaTitle: design?.title ?? document.canvaTitle,
      canvaDesignUpdatedAt: design?.updatedAt ?? document.canvaDesignUpdatedAt,
      canvaCheckedAt: new Date(),
      googleModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
      lastEditedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
      lastSyncedAt: new Date(),
    },
  });

  const sharing = await syncSharing(updated);
  warnings.push(...sharing.warnings);

  if (!options?.silent) {
    await recordAudit({
      actor,
      action: "canva.export",
      targetType: "Document",
      targetId: document.id,
      summary:
        document.visibility === "PRIVATE"
          ? "Re-exported a private Canva design"
          : `Re-exported “${document.title}” from Canva`,
      metadata: { format: exported.format, sizeBytes: exported.bytes.byteLength },
    });
  }

  return { document: updated, warnings };
}

/** Ask Canva whether the design has moved on since the last export. */
export async function checkCanvaFreshness(documentId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document?.canvaDesignId) return null;

  const design = await canvaProvider().getDesign(document.canvaDesignId);
  if (!design) return null;

  return prisma.document.update({
    where: { id: document.id },
    data: {
      canvaTitle: design.title ?? document.canvaTitle,
      canvaDesignUpdatedAt: design.updatedAt,
      canvaCheckedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Register something that already exists
// ---------------------------------------------------------------------------

export async function registerDocument(
  actor: User,
  input: {
    title: string;
    description?: string;
    link: string;
    categoryId: string;
    productionId?: string;
    visibility: Visibility;
    editAccess?: string;
    tags?: string;
    organize?: boolean;
    externalOnly?: boolean;
    docType?: DocType;
  },
): Promise<DocumentServiceResult> {
  const [config, category, production] = await Promise.all([
    getConfig(),
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.productionId
      ? prisma.production.findUnique({ where: { id: input.productionId } })
      : Promise.resolve(null),
  ]);
  if (!category) throw new Error("That category no longer exists.");
  if (category.scope === "PRODUCTION" && !production) {
    throw new Error(`Documents in ${category.name} have to be attached to a production.`);
  }
  assertVisibilityAllowed(category, input.visibility, Boolean(production));

  const warnings: string[] = [];
  const provider = driveProvider();
  const fileId = input.externalOnly ? null : extractDriveFileId(input.link);

  let docType: DocType = input.docType ?? "LINK";
  let webViewLink = input.link.trim();
  let driveOwnerEmail: string | null = null;
  let googleModifiedAt: Date | null = null;
  let driveFolderId: string | null = null;

  if (fileId) {
    const existing = await prisma.document.findUnique({ where: { googleFileId: fileId } });
    if (existing) {
      throw new Error(
        `That file is already on the hub as “${existing.title}”. Open it from the documents list instead.`,
      );
    }

    const file = await provider.getFile(fileId);
    if (!file) {
      const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
      throw new Error(
        `The hub's Google account (${account?.email ?? "not connected"}) cannot see that file. Share it with that address as an editor, then try again — or tick "just save the link" to record it without Drive access.`,
      );
    }
    docType = docTypeFromMime(file.mimeType);
    webViewLink = file.webViewLink || driveViewLink(file.id, docType);
    driveOwnerEmail = file.ownerEmail ?? null;
    googleModifiedAt = file.modifiedTime ? new Date(file.modifiedTime) : null;

    if (input.organize) {
      try {
        driveFolderId = await resolveFolder({ category, production });
        await provider.moveFile(fileId, driveFolderId);
      } catch (error) {
        driveFolderId = null;
        warnings.push(
          `Recorded the file, but could not move it into the hub's folders: ${(error as Error).message}`,
        );
      }
    }
  } else if (!input.externalOnly) {
    warnings.push(
      "That did not look like a Google Drive link, so it was saved as a plain external link.",
    );
  }

  const document = await prisma.document.create({
    data: {
      title: documentName(config, { baseTitle: input.title, category, production }),
      baseTitle: input.title,
      description: input.description ?? null,
      docType,
      source: fileId ? "REGISTERED" : "LINK",
      visibility: input.visibility,
      editAccess: clampEditAccess(input.visibility, input.editAccess ?? category.defaultEditAccess),
      categoryId: category.id,
      productionId: production?.id ?? null,
      creatorId: actor.id,
      googleFileId: fileId,
      webViewLink,
      driveFolderId,
      driveOwnerEmail,
      googleModifiedAt,
      // Nothing to go on for a plain link, so the hub's own clock stands in.
      lastEditedAt: googleModifiedAt ?? new Date(),
      lastSyncedAt: fileId ? new Date() : null,
      tags: { connect: await tagIds(input.tags) },
      metadata: JSON.stringify({ registeredFrom: input.link, driveMode: env.driveMode }),
    },
  });

  if (fileId) {
    const sharing = await syncSharing(document);
    warnings.push(...sharing.warnings);
  }

  await recordAudit({
    actor,
    action: "document.register",
    targetType: "Document",
    targetId: document.id,
    summary:
      input.visibility === "PRIVATE"
        ? `Registered a private file in ${category.name}`
        : `Registered “${document.title}” in ${category.name}`,
    metadata: { docType, source: document.source },
  });

  return { document, warnings };
}

// ---------------------------------------------------------------------------
// Update / archive / remove
// ---------------------------------------------------------------------------

export async function updateDocument(
  actor: User,
  input: {
    id: string;
    title: string;
    description?: string;
    categoryId: string;
    productionId?: string;
    visibility: Visibility;
    editAccess?: string;
    tags?: string;
    pinned?: boolean;
  },
): Promise<DocumentServiceResult> {
  const current = await prisma.document.findUnique({
    where: { id: input.id },
    include: { category: true, production: true },
  });
  if (!current) throw new Error("That document no longer exists.");

  const [config, category, production] = await Promise.all([
    getConfig(),
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.productionId
      ? prisma.production.findUnique({ where: { id: input.productionId } })
      : Promise.resolve(null),
  ]);
  if (!category) throw new Error("That category no longer exists.");
  if (category.scope === "PRODUCTION" && !production) {
    throw new Error(`Documents in ${category.name} have to be attached to a production.`);
  }
  assertVisibilityAllowed(category, input.visibility, Boolean(production));

  const warnings: string[] = [];
  const movedShelf =
    current.categoryId !== category.id || (current.productionId ?? null) !== (production?.id ?? null);

  // The name is composed, not typed: the form edits the base, and moving a
  // document to another show or shelf recomposes it — which is the whole
  // point of keeping the rule's inputs rather than its output.
  const name = documentName(config, { baseTitle: input.title, category, production });
  const renamed = current.title !== name;

  const document = await prisma.document.update({
    where: { id: current.id },
    data: {
      title: name,
      baseTitle: input.title,
      description: input.description ?? null,
      categoryId: category.id,
      productionId: production?.id ?? null,
      visibility: input.visibility,
      editAccess: clampEditAccess(
        input.visibility,
        input.editAccess ?? current.editAccess,
      ),
      pinned: input.pinned ?? false,
      tags: { set: await tagIds(input.tags) },
    },
  });

  // Keep Drive in step: rename and re-file when the hub metadata changed.
  // Files the hub owns are fair game even if they arrived by import — that is
  // the point of transferring ownership. Files somebody else owns are left
  // alone, since renaming them would change what they see in their own Drive.
  const driveAccount = await getDriveAccount();
  const hubOwnsFile =
    document.source === "CREATED" ||
    (Boolean(driveAccount?.email) && document.driveOwnerEmail === driveAccount?.email);

  if (document.googleFileId && hubOwnsFile) {
    const provider = driveProvider();
    if (renamed || movedShelf) {
      // Uploads keep their extension; a Google-native file has none.
      const fileName = document.originalFileName
        ? withExtension(name, document.originalFileName)
        : name;
      try {
        await provider.renameFile(document.googleFileId, fileName);
      } catch (error) {
        warnings.push(`Could not rename the file in Drive: ${(error as Error).message}`);
      }
    }
    if (movedShelf) {
      try {
        const folderId = await resolveFolder({ category, production });
        await provider.moveFile(document.googleFileId, folderId);
        await prisma.document.update({ where: { id: document.id }, data: { driveFolderId: folderId } });
      } catch (error) {
        warnings.push(`Could not move the file in Drive: ${(error as Error).message}`);
      }
    }
  }

  // The file's own labels are the fallback for scripts/rebuild-from-drive.ts,
  // so they have to follow the hub rather than record where a document started
  // out. Best effort: a document is not worth failing to save over a label.
  if (
    document.googleFileId &&
    hubOwnsFile &&
    (movedShelf || current.visibility !== document.visibility)
  ) {
    try {
      await driveProvider().setAppProperties(document.googleFileId, {
        hubDocumentId: document.id,
        hubCategory: category.slug,
        hubProduction: production?.slug ?? "",
        hubVisibility: document.visibility,
      });
    } catch (error) {
      console.error("[documents] could not update hub labels in Drive", error);
    }
  }

  if (current.visibility !== document.visibility || current.editAccess !== document.editAccess) {
    const sharing = await syncSharing(document);
    warnings.push(...sharing.warnings);
    await recordAudit({
      actor,
      action: "document.visibility",
      targetType: "Document",
      targetId: document.id,
      summary: `Changed a document in ${category.name} from ${current.visibility.toLowerCase()} to ${document.visibility.toLowerCase()}`,
    });
  }

  await recordAudit({
    actor,
    action: "document.update",
    targetType: "Document",
    targetId: document.id,
    summary:
      document.visibility === "PRIVATE"
        ? `Updated a private document in ${category.name}`
        : `Updated “${document.title}”`,
  });

  return { document, warnings };
}

export async function setDocumentStatus(actor: User, id: string, status: "ACTIVE" | "ARCHIVED") {
  const document = await prisma.document.update({ where: { id }, data: { status } });
  await recordAudit({
    actor,
    action: status === "ARCHIVED" ? "document.archive" : "document.restore",
    targetType: "Document",
    targetId: id,
    summary:
      document.visibility === "PRIVATE"
        ? `${status === "ARCHIVED" ? "Archived" : "Restored"} a private document`
        : `${status === "ARCHIVED" ? "Archived" : "Restored"} “${document.title}”`,
  });
  return document;
}

export async function removeDocument(actor: User, id: string, trashInDrive: boolean) {
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return;
  const warnings: string[] = [];

  if (trashInDrive && document.googleFileId && document.source === "CREATED") {
    try {
      await driveProvider().trashFile(document.googleFileId);
    } catch (error) {
      warnings.push(`Could not move the Drive file to the trash: ${(error as Error).message}`);
    }
  }

  await prisma.document.delete({ where: { id } });
  await recordAudit({
    actor,
    action: "document.delete",
    targetType: "Document",
    targetId: id,
    summary:
      document.visibility === "PRIVATE"
        ? "Removed a private document from the hub"
        : `Removed “${document.title}” from the hub`,
    metadata: { trashInDrive },
  });
  return warnings;
}

/** Re-read the Drive file so the hub shows accurate "last changed" data. */
export async function syncDocument(actor: User | null, id: string) {
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document?.googleFileId) return { changed: false, missing: false };

  const file = await driveProvider().getFile(document.googleFileId);
  if (!file || file.trashed) {
    await prisma.document.update({
      where: { id },
      data: { status: "ARCHIVED", lastSyncedAt: new Date() },
    });
    await recordAudit({
      actor,
      action: "document.sync",
      targetType: "Document",
      targetId: id,
      summary: `“${document.title}” is gone from Drive, so it was archived on the hub`,
    });
    return { changed: true, missing: true };
  }

  const modifiedAt = file.modifiedTime ? new Date(file.modifiedTime) : document.googleModifiedAt;
  await prisma.document.update({
    where: { id },
    data: {
      webViewLink: file.webViewLink || document.webViewLink,
      driveOwnerEmail: file.ownerEmail ?? document.driveOwnerEmail,
      googleModifiedAt: modifiedAt,
      ...(modifiedAt ? { lastEditedAt: modifiedAt } : {}),
      lastSyncedAt: new Date(),
    },
  });
  return { changed: true, missing: false };
}

// ---------------------------------------------------------------------------
// Applying the naming rule to what is already here
// ---------------------------------------------------------------------------

/**
 * Re-compose every document's title from its base and the current rule.
 *
 * Two jobs in one: the retroactive pass for a hub whose titles predate the
 * rule being applied to them at all, and the tidy-up after an admin edits the
 * rule — a naming rule nobody can apply to what is already filed is only half
 * a rule. Idempotent, so running it twice is a no-op, and it touches nothing
 * in Drive: the files there are already named by the rule.
 */
export async function normaliseDocumentTitles(options?: {
  /** Work out what would change without changing it. */
  dryRun?: boolean;
  /** Stop after this many rows; the caller can resume. */
  limit?: number;
}): Promise<{ scanned: number; changed: number; examples: Array<{ from: string; to: string }> }> {
  const config = await getConfig();
  const documents = await prisma.document.findMany({
    select: {
      id: true,
      title: true,
      baseTitle: true,
      category: { select: { name: true } },
      production: { select: { name: true, abbreviation: true, season: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(options?.limit ? { take: options.limit } : {}),
  });

  const examples: Array<{ from: string; to: string }> = [];
  let changed = 0;

  for (const document of documents) {
    const next = documentName(config, {
      baseTitle: document.baseTitle,
      category: document.category,
      production: document.production,
    });
    if (next === document.title) continue;
    changed += 1;
    if (examples.length < 5) examples.push({ from: document.title, to: next });
    if (!options?.dryRun) {
      await prisma.document.update({ where: { id: document.id }, data: { title: next } });
    }
  }

  if (!options?.dryRun) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { titlesNormalisedAt: new Date() },
    });
  }

  return { scanned: documents.length, changed, examples };
}

// ---------------------------------------------------------------------------
// Individual shares
// ---------------------------------------------------------------------------

export async function shareDocument(
  actor: User,
  input: { documentId: string; userId: string; accessLevel: "READER" | "WRITER" },
) {
  const [document, user] = await Promise.all([
    prisma.document.findUnique({ where: { id: input.documentId } }),
    prisma.user.findUnique({ where: { id: input.userId } }),
  ]);
  if (!document) throw new Error("That document no longer exists.");
  if (!user) throw new Error("That member no longer exists.");
  if (user.id === document.creatorId) {
    throw new Error("The creator already has access.");
  }

  await prisma.documentShare.upsert({
    where: { documentId_userId: { documentId: document.id, userId: user.id } },
    create: {
      documentId: document.id,
      userId: user.id,
      accessLevel: input.accessLevel,
      grantedById: actor.id,
    },
    update: { accessLevel: input.accessLevel, grantedById: actor.id },
  });

  const sharing = await syncSharing(document);

  // Being given a private document is invisible otherwise — it appears on
  // their dashboard with no announcement — so this one is worth an email.
  if (document.visibility === "PRIVATE") {
    const config = await getConfig();
    const { privateShareNotice, sendEmailQuietly } = await import("./email");
    sendEmailQuietly({
      to: user.email,
      relatedId: document.id,
      message: privateShareNotice({
        orgName: config.orgName,
        appUrl: env.appUrl,
        name: user.name,
        sharedBy: actor.name ?? actor.email,
        documentTitle: document.title,
        documentUrl: `${env.appUrl.replace(/\/$/, "")}/documents/${document.id}`,
        accessLevel: input.accessLevel,
      }),
    });
  }

  await recordAudit({
    actor,
    action: "document.share",
    targetType: "Document",
    targetId: document.id,
    summary: `Gave ${user.email} ${input.accessLevel.toLowerCase()} access to ${
      document.visibility === "PRIVATE" ? "a private document" : `“${document.title}”`
    }`,
  });
  return sharing.warnings;
}

export async function unshareDocument(actor: User, documentId: string, userId: string) {
  const share = await prisma.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId } },
    include: { user: true, document: true },
  });
  if (!share) return [];
  await prisma.documentShare.delete({ where: { id: share.id } });
  const sharing = await syncSharing(share.document);
  await recordAudit({
    actor,
    action: "document.unshare",
    targetType: "Document",
    targetId: documentId,
    summary: `Removed ${share.user.email}'s access to ${
      share.document.visibility === "PRIVATE" ? "a private document" : `“${share.document.title}”`
    }`,
  });
  return sharing.warnings;
}
