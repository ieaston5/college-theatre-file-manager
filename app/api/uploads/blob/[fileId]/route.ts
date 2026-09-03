import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { canViewDocument, getViewerContext } from "@/lib/access";
import { readMockBlob } from "@/lib/google/mock";

/**
 * Serves the bytes of a file uploaded while the hub is on the simulated Drive,
 * so "open" and "download" actually work during evaluation. Access is checked
 * against the same rules as the hub itself.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  if (env.driveMode !== "mock") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });

  const { fileId } = await params;
  const document = await prisma.document.findUnique({
    where: { googleFileId: fileId },
    include: { shares: { select: { userId: true } } },
  });
  if (!document) return NextResponse.json({ error: "Unknown file." }, { status: 404 });

  const viewer = await getViewerContext(user);
  if (!canViewDocument(viewer, document)) {
    return NextResponse.json({ error: "Unknown file." }, { status: 404 });
  }

  const blob = readMockBlob(fileId);
  if (!blob) return NextResponse.json({ error: "No bytes stored." }, { status: 404 });

  // Hub file names contain em dashes and other non-Latin-1 characters, which
  // cannot go in a raw header value — hence the RFC 5987 form plus an ASCII
  // fallback for older clients.
  const asciiName = blob.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "Content-Type": blob.mimeType,
      "Content-Length": String(blob.bytes.byteLength),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
        blob.name,
      )}`,
      "Cache-Control": "private, no-store",
    },
  });
}
