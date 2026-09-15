import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canViewDocument, getViewerContext } from "@/lib/access";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not available." }, { status: 401 });
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id }, include: { shares: { select: { userId: true } } } });
  if (!document || !canViewDocument(await getViewerContext(user), document)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  return NextResponse.json({ pending: Boolean(document.sharingDirtyAt), failed: Boolean(document.sharingError) },
    { headers: { "Cache-Control": "no-store" } });
}
