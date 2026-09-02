import type { Document, User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { getConfig } from "./config";
import { recordAudit } from "./audit";
import { driveProvider, resolveFolder } from "./google";
import type { DocHeader, SharingPlan, SharingResult } from "./google/types";
import {
  DOC_TYPE_META,
  docTypeFromMime,
  type CreatableDocType,
  type DocType,
  type Visibility,
} from "./constants";
import {
  applyNamingTemplate,
  driveViewLink,
  extractDriveFileId,
  parseTagInput,
  slugify,
} from "./utils";

export type DocumentServiceResult = {
  document: Document;
  warnings: string[];
};

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

async function sharingPlanFor(
  doc: Pick<Document, "id" | "visibility" | "source" | "creatorId">,
): Promise<SharingPlan> {
  const config = await getConfig();
  const [creator, shares] = await Promise.all([
    prisma.user.findUnique({ where: { id: doc.creatorId } }),
    prisma.documentShare.findMany({ where: { documentId: doc.id }, include: { user: true } }),
  ]);

  return {
    visibility: doc.visibility as Visibility,
    creatorEmail: creator?.email ?? "",
    groupEmail: config.groupEmail,
    groupCanEdit: config.groupCanEdit,
    extra: shares.map((share) => ({
      email: share.user.email,
      level: share.accessLevel as "READER" | "WRITER",
    })),
    strategy: doc.source === "CREATED" ? "reconcile" : "additive",
  };
}

/** Push a document's visibility + share list into Drive. */
export async function syncSharing(
  doc: Pick<Document, "id" | "visibility" | "source" | "creatorId" | "googleFileId" | "docType">,
): Promise<SharingResult> {
  if (!doc.googleFileId || doc.docType === "LINK") {
    return { granted: [], revoked: [], warnings: [] };
  }
  const plan = await sharingPlanFor(doc);
  if (!plan.creatorEmail) {
    return { granted: [], revoked: [], warnings: ["Could not find the creator's email address."] };
  }
  const result = await driveProvider().applySharing(doc.googleFileId, plan);

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

  const warnings: string[] = [];

  // 1. Reserve the hub record first so the Drive file can link back to it.
  const record = await prisma.document.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      docType: input.docType,
      source: "CREATED",
      visibility: input.visibility,
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
    const fileName = applyNamingTemplate(config.namingTemplate, {
      production: production?.abbreviation || production?.name || null,
      category: category.name,
      title: input.title,
      season: production?.season ?? config.currentSeason,
    });

    const header: DocHeader | null = config.stampDocHeader
      ? {
          title: input.title,
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
      name: fileName,
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
        lastSyncedAt: new Date(),
      },
    });

    const sharing = await syncSharing(updated);
    warnings.push(...sharing.warnings);

    if (input.visibility === "BOARD" && !config.groupEmail) {
      warnings.push(
        "No board Google Group is configured yet, so this document was not shared in Drive. An admin can set it in Admin → Settings.",
      );
    }

    await recordAudit({
      actor,
      action: "document.create",
      targetType: "Document",
      targetId: updated.id,
      summary:
        input.visibility === "PRIVATE"
          ? `Created a private ${DOC_TYPE_META[input.docType].short.toLowerCase()} in ${category.name}`
          : `Created “${input.title}” in ${category.name}${production ? ` for ${production.name}` : ""}`,
      metadata: { docType: input.docType, visibility: input.visibility, fileName },
    });

    return { document: updated, warnings };
  } catch (error) {
    // Don't leave a phantom row behind if Drive refused.
    await prisma.document.delete({ where: { id: record.id } }).catch(() => {});
    throw error;
  }
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
    tags?: string;
    organize?: boolean;
    externalOnly?: boolean;
    docType?: DocType;
  },
): Promise<DocumentServiceResult> {
  const [category, production] = await Promise.all([
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.productionId
      ? prisma.production.findUnique({ where: { id: input.productionId } })
      : Promise.resolve(null),
  ]);
  if (!category) throw new Error("That category no longer exists.");
  if (category.scope === "PRODUCTION" && !production) {
    throw new Error(`Documents in ${category.name} have to be attached to a production.`);
  }

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
      title: input.title,
      description: input.description ?? null,
      docType,
      source: fileId ? "REGISTERED" : "LINK",
      visibility: input.visibility,
      categoryId: category.id,
      productionId: production?.id ?? null,
      creatorId: actor.id,
      googleFileId: fileId,
      webViewLink,
      driveFolderId,
      driveOwnerEmail,
      googleModifiedAt,
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
        : `Registered “${input.title}” in ${category.name}`,
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

  const warnings: string[] = [];
  const movedShelf =
    current.categoryId !== category.id || (current.productionId ?? null) !== (production?.id ?? null);
  const renamed = current.title !== input.title;

  const document = await prisma.document.update({
    where: { id: current.id },
    data: {
      title: input.title,
      description: input.description ?? null,
      categoryId: category.id,
      productionId: production?.id ?? null,
      visibility: input.visibility,
      pinned: input.pinned ?? false,
      tags: { set: await tagIds(input.tags) },
    },
  });

  // Keep Drive in step: rename and re-file when the hub metadata changed.
  if (document.googleFileId && document.source === "CREATED") {
    const provider = driveProvider();
    if (renamed || movedShelf) {
      const fileName = applyNamingTemplate(config.namingTemplate, {
        production: production?.abbreviation || production?.name || null,
        category: category.name,
        title: input.title,
        season: production?.season ?? config.currentSeason,
      });
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

  if (current.visibility !== document.visibility) {
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

  await prisma.document.update({
    where: { id },
    data: {
      webViewLink: file.webViewLink || document.webViewLink,
      driveOwnerEmail: file.ownerEmail ?? document.driveOwnerEmail,
      googleModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : document.googleModifiedAt,
      lastSyncedAt: new Date(),
    },
  });
  return { changed: true, missing: false };
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
