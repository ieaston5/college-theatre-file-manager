import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { writeMockUpload } from "@/lib/google/mock";
import { UPLOAD_MAX_BYTES } from "@/lib/constants";

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

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "That file is over the 100 MB limit." }, { status: 413 });
  }

  const file = writeMockUpload({
    fileId: pending.document?.googleFileId ?? undefined,
    name: pending.driveName,
    mimeType: pending.mimeType,
    parentFolderId: pending.driveFolderId,
    appProperties: { hubUploadToken: pending.token },
    bytes,
  });

  return NextResponse.json({ fileId: file.id });
}
