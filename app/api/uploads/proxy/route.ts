import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { pushToSession } from "@/lib/google/upload";
import { readSmallUploadBody, UploadBodyError } from "@/lib/upload-body";

/**
 * Fallback for browsers that cannot PUT straight to Google (blocked by a
 * proxy or an extension). The bytes come through the app instead.
 *
 * The destination is the session URI we stored when authorising the upload —
 * never a URL from the request — so this cannot be turned into an open relay.
 */
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });

  const uploadId = request.nextUrl.searchParams.get("u");
  if (!uploadId) return NextResponse.json({ error: "Missing upload id." }, { status: 400 });

  const pending = await prisma.pendingUpload.findUnique({ where: { id: uploadId } });
  if (!pending || pending.createdById !== user.id || pending.status !== "PENDING") {
    return NextResponse.json({ error: "That upload is no longer open." }, { status: 404 });
  }
  if (!pending.sessionUrl) {
    return NextResponse.json({ error: "That upload has no Google session." }, { status: 400 });
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await readSmallUploadBody(request, pending.sizeBytes);
  } catch (error) {
    if (error instanceof UploadBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The upload was interrupted. Please retry." }, { status: 502 });
  }

  try {
    const fileId = await pushToSession(pending.sessionUrl, bytes, pending.mimeType);
    await prisma.pendingUpload.update({ where: { id: pending.id }, data: { uploadedFileId: fileId } });
    return NextResponse.json({ fileId });
  } catch (error) {
    console.error("[upload] proxy failed", error);
    const message = error instanceof Error ? error.message : "The upload failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
