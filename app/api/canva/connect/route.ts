import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { beginCanvaAuthorization } from "@/lib/canva/oauth";

/** Starts the OAuth flow for the Canva account that will own the exports. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.redirect(new URL("/no-access?need=admin", request.url));
  }
  if (!env.canvaConfigured) {
    return NextResponse.redirect(new URL("/admin?error=canva_not_configured", request.url));
  }

  try {
    const url = await beginCanvaAuthorization(user!.id);
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "canva_start_failed";
    return NextResponse.redirect(
      new URL(`/admin?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
