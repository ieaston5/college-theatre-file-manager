import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { canCreateDocuments, canEditDocument, getViewerContext } from "@/lib/access";
import { assertCreationAllowed, documentName } from "@/lib/documents";
import { getConfig } from "@/lib/config";
import { resolveFolder } from "@/lib/google";
import { openResumableCreate, openResumableUpdate } from "@/lib/google/upload";
import { UPLOADED_DOC_TYPES, type DocType } from "@/lib/constants";
import { firstError, uploadStartSchema } from "@/lib/validation";
import { randomToken } from "@/lib/crypto";
import { rateLimit, tooManyMessage } from "@/lib/rate-limit";
import { fileNameToTitle, withExtension } from "@/lib/utils";

/**
 * Authorises an upload and hands back somewhere to send the bytes.
 *
 * Everything that decides *where the file lands and what it is called* is
 * settled here, server-side, and baked into the Drive upload session — so the
 * browser cannot rename the file or move it out of the hub's folder tree.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  const viewer = await getViewerContext(user);
  if (!canCreateDocuments(viewer)) {
    return NextResponse.json(
      { error: "You do not have permission to add documents to the hub." },
      { status: 403 },
    );
  }

  // Keyed on the user rather than the address: every caller here is signed in,
  // and a signed-in id is the thing that cannot be spoofed.
  const limit = await rateLimit("uploadStart", user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { error: tooManyMessage(limit, "uploads") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const parsed = uploadStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  }
  const input = parsed.data;
  const token = randomToken(18);

  // Opportunistic tidy-up: uploads that were started and abandoned.
  await prisma.pendingUpload
    .deleteMany({
      where: {
        status: { not: "COMPLETE" },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    .catch(() => {});

  try {
    // --- replacing the contents of an existing document --------------------
    if (input.mode === "version") {
      if (!input.documentId) {
        return NextResponse.json({ error: "Missing document id." }, { status: 400 });
      }
      const document = await prisma.document.findUnique({
        where: { id: input.documentId },
        include: { shares: { select: { userId: true } } },
      });
      if (!document || !canEditDocument(viewer, document)) {
        return NextResponse.json(
          { error: "That document is not yours to change." },
          { status: 403 },
        );
      }
      if (!document.googleFileId) {
        return NextResponse.json(
          { error: "That document has no file behind it, so there is nothing to replace." },
          { status: 400 },
        );
      }
      if (!UPLOADED_DOC_TYPES.includes(document.docType as DocType)) {
        return NextResponse.json(
          {
            error:
              "New versions can only be uploaded over uploaded files. Google Docs, Sheets and Slides keep their own version history — just edit them.",
          },
          { status: 400 },
        );
      }

      // Recompute the canonical name rather than reusing whatever the new file
      // was called on someone's laptop — a new version must not quietly rename
      // the document out of the hub's naming rule. Only the extension follows
      // the new file, in case the format changed.
      const [config, category, production] = await Promise.all([
        getConfig(),
        prisma.category.findUnique({ where: { id: document.categoryId } }),
        document.productionId
          ? prisma.production.findUnique({ where: { id: document.productionId } })
          : Promise.resolve(null),
      ]);
      const driveName = withExtension(
        documentName(config, { baseTitle: document.baseTitle, category, production }),
        input.fileName,
      );

      const pending = await prisma.pendingUpload.create({
        data: {
          token,
          createdById: user.id,
          documentId: document.id,
          payload: JSON.stringify({ mode: "version" }),
          fileName: input.fileName,
          driveName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          driveFolderId: document.driveFolderId,
        },
      });

      if (env.driveMode === "google") {
        const sessionUrl = await openResumableUpdate({
          fileId: document.googleFileId,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          appProperties: { hubUploadToken: token, hubDocumentId: document.id },
        });
        await prisma.pendingUpload.update({ where: { id: pending.id }, data: { sessionUrl } });
        return NextResponse.json({
          uploadId: pending.id,
          kind: "resumable",
          uploadUrl: sessionUrl,
          proxyUrl: `/api/uploads/proxy?u=${pending.id}`,
        });
      }

      return NextResponse.json({
        uploadId: pending.id,
        kind: "direct",
        uploadUrl: `/api/uploads/mock?u=${pending.id}`,
      });
    }

    // --- a brand new document ---------------------------------------------
    if (!input.categoryId || !input.visibility) {
      return NextResponse.json({ error: "Pick a category and who can see it." }, { status: 400 });
    }

    const [config, category, production] = await Promise.all([
      getConfig(),
      prisma.category.findUnique({ where: { id: input.categoryId } }),
      input.productionId
        ? prisma.production.findUnique({ where: { id: input.productionId } })
        : Promise.resolve(null),
    ]);

    if (!category) {
      return NextResponse.json({ error: "That category no longer exists." }, { status: 400 });
    }
    if (category.scope === "PRODUCTION" && !production) {
      return NextResponse.json(
        { error: `Documents in ${category.name} have to be attached to a production.` },
        { status: 400 },
      );
    }
    if (category.scope === "STANDING" && production) {
      return NextResponse.json(
        { error: `${category.name} is organisation-wide — leave the production blank.` },
        { status: 400 },
      );
    }

    try {
      assertCreationAllowed(viewer, {
        categoryId: category.id,
        productionId: production?.id ?? null,
        visibility: input.visibility,
      });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 });
    }

    const title = (input.title?.trim() || fileNameToTitle(input.fileName)).slice(0, 160);
    const driveFolderId = await resolveFolder({ category, production });
    const driveName = withExtension(
      documentName(config, { baseTitle: title, category, production }),
      input.fileName,
    );

    const pending = await prisma.pendingUpload.create({
      data: {
        token,
        createdById: user.id,
        payload: JSON.stringify({
          mode: "new",
          title,
          description: input.description ?? null,
          categoryId: category.id,
          productionId: production?.id ?? null,
          visibility: input.visibility,
          editAccess: input.editAccess ?? category.defaultEditAccess,
          tags: input.tags ?? null,
        }),
        fileName: input.fileName,
        driveName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        driveFolderId,
      },
    });

    const appProperties = {
      hubUploadToken: token,
      hubCategory: category.slug,
      hubProduction: production?.slug ?? "",
      hubVisibility: input.visibility,
    };

    if (env.driveMode === "google") {
      const sessionUrl = await openResumableCreate({
        name: driveName,
        mimeType: input.mimeType,
        parentFolderId: driveFolderId,
        sizeBytes: input.sizeBytes,
        description: [
          input.description,
          `${config.orgName} Hub · ${category.name}${production ? ` · ${production.name}` : ""}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        appProperties,
      });
      await prisma.pendingUpload.update({ where: { id: pending.id }, data: { sessionUrl } });
      return NextResponse.json({
        uploadId: pending.id,
        kind: "resumable",
        uploadUrl: sessionUrl,
        proxyUrl: `/api/uploads/proxy?u=${pending.id}`,
        driveName,
        title,
      });
    }

    return NextResponse.json({
      uploadId: pending.id,
      kind: "direct",
      uploadUrl: `/api/uploads/mock?u=${pending.id}`,
      driveName,
      title,
    });
  } catch (error) {
    console.error("[upload] could not start", error);
    const message = error instanceof Error ? error.message : "Could not start the upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
