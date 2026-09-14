import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { writeMockUpload } from "@/lib/google/mock";
import { readSmallUploadBody, UploadBodyError } from "@/lib/upload-body";

/** Where uploads go while the hub is running on the simulated Drive. */
export async function PUT(request: NextRequest) {
  if (env.driveMode !== "mock") {
    return NextResponse.json({ error: "The hub is connected to Google Drive." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });

  const uploadId = request.nextUrl.searchParams.get("u");
  if (!uploadId) return NextResponse.json({ error: "Missing upload id." }, { status: 400 });

  const pending = await prisma.pendingUpload.findUnique({
    where: { id: uploadId },
    include: { document: { select: { googleFileId: true } } },
  });
  if (!pending || pending.createdById !== user.id || pending.status !== "PENDING") {
    return NextResponse.json({ error: "That upload is no longer open." }, { status: 404 });
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

  const file = writeMockUpload({
    fileId: pending.document?.googleFileId ?? undefined,
    name: pending.driveName,
    mimeType: pending.mimeType,
    parentFolderId: pending.driveFolderId,
    appProperties: { hubUploadToken: pending.token },
    bytes: Buffer.from(bytes),
  });

  await prisma.pendingUpload.update({ where: { id: pending.id }, data: { uploadedFileId: file.id } });

  return NextResponse.json({ fileId: file.id });
}
