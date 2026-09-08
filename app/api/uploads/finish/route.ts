import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { driveProvider } from "@/lib/google";
import { recordNewVersion, recordUploadedDocument } from "@/lib/documents";
import { firstError, uploadFinishSchema } from "@/lib/validation";
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
    include: { document: true },
  });
  if (!pending || pending.createdById !== user.id) {
    return NextResponse.json({ error: "That upload is not yours." }, { status: 403 });
  }
  if (pending.status !== "PENDING") {
    return NextResponse.json({ error: "That upload was already finished." }, { status: 409 });
  }

  const fileId = parsed.data.fileId ?? pending.document?.googleFileId;
  if (!fileId) {
    return NextResponse.json({ error: "Missing the uploaded file id." }, { status: 400 });
  }

  try {
    const file = await driveProvider().getFile(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "Google does not have that file. The upload may not have completed." },
        { status: 400 },
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

    const payload = JSON.parse(pending.payload) as DraftPayload;

    if (payload.mode === "version" || pending.documentId) {
      if (!pending.documentId) {
        return NextResponse.json({ error: "Missing document id." }, { status: 400 });
      }
      const document = await recordNewVersion(
        user,
        pending.documentId,
        {
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes ?? pending.sizeBytes,
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

    const { document, warnings } = await recordUploadedDocument(user, {
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
        sizeBytes: file.sizeBytes ?? pending.sizeBytes,
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
    await prisma.pendingUpload
      .update({ where: { id: pending.id }, data: { status: "FAILED" } })
      .catch(() => {});
    const message = error instanceof Error ? error.message : "Could not finish the upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
