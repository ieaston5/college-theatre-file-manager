import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { canEditDocument, getViewerContext } from "@/lib/access";
import { assertCreationAllowed } from "@/lib/documents";
import type { Visibility } from "@/lib/constants";
import { resumableUploadStatus, UploadSessionError } from "@/lib/google/upload";
import { firstError, uploadFinishSchema } from "@/lib/validation";

/** Only the uploader may inspect or recover the stored resumable capability. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = uploadFinishSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  const pending = await prisma.pendingUpload.findUnique({
    where: { id: parsed.data.uploadId },
    include: { document: { include: { shares: { select: { userId: true } } } } },
  });
  if (!pending || pending.createdById !== user.id) {
    return NextResponse.json({ error: "That upload is not available to your account." }, { status: 404 });
  }
  const sizeBytes = Number(pending.sizeBytes ?? 0);
  if (pending.status === "COMPLETE" || (pending.status === "PENDING" && pending.uploadedFileId)) {
    const fileId = pending.uploadedFileId ?? pending.document?.googleFileId;
    if (fileId) return NextResponse.json({ complete: true, offset: sizeBytes, fileId });
  }
  if (pending.status !== "PENDING") {
    return NextResponse.json({ error: "That upload is no longer open. Select the file again." }, { status: 410 });
  }
  // A long upload can outlive a membership. Do not hand out the stored
  // session capability again after the member loses upload permission.
  const viewer = await getViewerContext(user);
  try {
    const payload = JSON.parse(pending.payload) as { mode: string; categoryId: string; productionId?: string | null; visibility: Visibility };
    if (payload.mode === "version") {
      if (!pending.document || !canEditDocument(viewer, pending.document)) throw new Error("You no longer have permission to update that document.");
    } else {
      assertCreationAllowed(viewer, { categoryId: payload.categoryId, productionId: payload.productionId ?? null, visibility: payload.visibility });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "You no longer have permission to upload that file." }, { status: 403 });
  }
  if (env.driveMode === "mock") {
    return NextResponse.json({ complete: false, offset: 0, uploadUrl: `/api/uploads/mock?u=${pending.id}` });
  }
  if (!pending.sessionUrl || !sizeBytes) {
    return NextResponse.json({ error: "That upload session is no longer available. Select the file again." }, { status: 410 });
  }
  try {
    const state = await resumableUploadStatus(pending.sessionUrl, sizeBytes);
    if (state.complete && state.fileId) {
      await prisma.pendingUpload.update({ where: { id: pending.id }, data: { uploadedFileId: state.fileId } });
    }
    return NextResponse.json({ ...state, ...(!state.complete ? { uploadUrl: pending.sessionUrl } : {}) });
  } catch (error) {
    if (error instanceof UploadSessionError) {
      return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not check upload progress. Please retry.", retryable: true }, { status: 502 });
  }
}
