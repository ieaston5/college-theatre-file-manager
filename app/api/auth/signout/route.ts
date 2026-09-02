import { NextResponse, type NextRequest } from "next/server";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({ actor: user, action: "auth.logout", summary: `${user.email} signed out` });
  }
  await clearSession();
  return NextResponse.redirect(new URL("/login?signed_out=1", request.url));
}
