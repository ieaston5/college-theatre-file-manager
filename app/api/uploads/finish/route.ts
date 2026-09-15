import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { kickSharingQueue } from "@/lib/sharing";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { driveProvider } from "@/lib/google";
import { assertCreationAllowed, recordNewVersion, recordUploadedDocument } from "@/lib/documents";
import { firstError, uploadFinishSchema } from "@/lib/validation";
import { canEditDocument, canViewDocument, getViewerContext } from "@/lib/access";
import type { Visibility } from "@/lib/constants";

type DraftPayload = {
  mode: "new" | "version";
  title?: string;
  description?: string | null;
  categoryId?: string;
  productionId?: string | null;
  visibility?: Visibility;
  editAccess?: string | null;
  tags?: string | null;
};

/**
 * Called once the bytes have landed. Confirms the file that turned up is the
 * one we authorised — the upload token we wrote into its appProperties has to
 * match — and only then does the document appear on the hub.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const parsed = uploadFinishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  }

  const pending = await prisma.pendingUpload.findUnique({
    where: { id: parsed.data.uploadId },
    include: { document: { include: { shares: { select: { userId: true } } } } },
  });
  if (!pending || pending.createdById !== user.id) {
    return NextResponse.json({ error: "That upload is not yours." }, { status: 403 });
  }
  if (pending.status === "COMPLETE" && pending.document) {
    if (!canViewDocument(await getViewerContext(user), pending.document)) {
      return NextResponse.json({ error: "You no longer have access to that document." }, { status: 403 });
    }
    if (pending.document.sharingDirtyAt) kickSharingQueue();
    return NextResponse.json({
      documentId: pending.document.id,
      title: pending.document.title,
      webViewLink: pending.document.webViewLink,
      warnings: [],
    });
  }
  if (pending.status !== "PENDING") {
    return NextResponse.json({ error: "That upload is no longer open. Select the file again." }, { status: 410 });
  }

  const fileId = parsed.data.fileId ?? pending.uploadedFileId ?? pending.document?.googleFileId;
  if (!fileId) {
    return NextResponse.json({ error: "Missing the uploaded file id." }, { status: 400 });
  }

  try {
    const file = await driveProvider().getFile(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "Google has not returned that file yet. The upload may still be completing.", retryable: true },
        { status: 502 },
      );
    }
    // The upload token proves this is the file this hub session authorised,
    // rather than any other file the hub account happens to be able to see.
    if (file.appProperties?.hubUploadToken !== pending.token) {
      await prisma.pendingUpload.update({
        where: { id: pending.id },
        data: { status: "FAILED" },
      });
      return NextResponse.json(
        { error: "That file does not match this upload. Nothing was added." },
        { status: 400 },
      );
    }

    // Metadata uses a JS number but all accepted sizes remain well below
    // Number.MAX_SAFE_INTEGER. Compare as BigInt to avoid truncation at 2 GB.
    if (file.sizeBytes == null || !Number.isSafeInteger(file.sizeBytes) ||
        pending.sizeBytes === null || BigInt(file.sizeBytes) !== pending.sizeBytes) {
      return NextResponse.json(
        { error: "The uploaded file size does not match the selected file. Please retry.", retryable: true },
        { status: 409 },
      );
    }
    await prisma.pendingUpload.update({ where: { id: pending.id }, data: { uploadedFileId: file.id } });
    const payload = JSON.parse(pending.payload) as DraftPayload;
    const viewer = await getViewerContext(user);

    if (payload.mode === "version" || pending.documentId) {
      if (!pending.documentId) {
        return NextResponse.json({ error: "Missing document id." }, { status: 400 });
      }
      const editableDocument = await prisma.document.findUnique({
        where: { id: pending.documentId }, include: { shares: { select: { userId: true } } },
      });
      if (!editableDocument || !canEditDocument(viewer, editableDocument)) {
        return NextResponse.json({ error: "You no longer have permission to update that document." }, { status: 403 });
      }
      const document = await recordNewVersion(
        user,
        pending.documentId,
        {
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          modifiedTime: file.modifiedTime,
        },
        pending.fileName,
      );
      await prisma.pendingUpload.update({
        where: { id: pending.id },
        data: { status: "COMPLETE" },
      });
      revalidatePath(`/documents/${document.id}`);
      revalidatePath("/", "layout");
      return NextResponse.json({
        documentId: document.id,
        title: document.title,
        webViewLink: document.webViewLink,
        warnings: [],
      });
    }

    if (!payload.categoryId || !payload.visibility || !payload.title) {
      return NextResponse.json({ error: "That upload is missing its details." }, { status: 400 });
    }

    try {
      assertCreationAllowed(viewer, {
        categoryId: payload.categoryId,
        productionId: payload.productionId ?? null,
        visibility: payload.visibility,
      });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 });
    }
    // Registration may already exist after a lost response. Its filing or
    // visibility may have changed since then; check the current row as well
    // as the metadata originally authorized for this upload.
    const registered = await prisma.document.findUnique({
      where: { id: `upload_${pending.id}` },
      include: { shares: { select: { userId: true } } },
    });
    if (registered && !canViewDocument(viewer, registered)) {
      return NextResponse.json({ error: "You no longer have access to that document." }, { status: 403 });
    }
    const { document, warnings } = await recordUploadedDocument(user, {
      uploadId: pending.id,
      title: payload.title,
      description: payload.description ?? undefined,
      categoryId: payload.categoryId,
      productionId: payload.productionId ?? undefined,
      visibility: payload.visibility,
      editAccess: payload.editAccess ?? undefined,
      tags: payload.tags ?? undefined,
      originalFileName: pending.fileName,
      driveFolderId: pending.driveFolderId,
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        sizeBytes: file.sizeBytes,
        ownerEmail: file.ownerEmail,
        modifiedTime: file.modifiedTime,
      },
    });

    await prisma.pendingUpload.update({
      where: { id: pending.id },
      data: { status: "COMPLETE", documentId: document.id },
    });
    revalidatePath("/", "layout");

    return NextResponse.json({
      documentId: document.id,
      title: document.title,
      webViewLink: document.webViewLink,
      warnings,
    });
  } catch (error) {
    console.error("[upload] could not finish", error);
    const message = error instanceof Error ? error.message : "Could not finish the upload.";
    return NextResponse.json({ error: message, retryable: true }, { status: 500 });
  }
}
