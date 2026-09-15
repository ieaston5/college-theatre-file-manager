import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { atLeast } from "@/lib/constants";
import { kickSharingQueue, sharingProgress } from "@/lib/sharing";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !atLeast(user.role, "BOARD")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const [progress, failures] = await Promise.all([
    sharingProgress(),
    prisma.document.count({ where: { sharingDirtyAt: { not: null }, sharingError: { not: null } } }),
  ]);
  if (progress.running) kickSharingQueue();
  return NextResponse.json({ ...progress, failures }, { headers: { "Cache-Control": "no-store" } });
}
