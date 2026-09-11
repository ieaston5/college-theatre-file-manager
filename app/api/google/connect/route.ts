import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { isAdmin } from "@/lib/auth";
import { createOAuthState, driveAuthUrl } from "@/lib/google/oauth";

/** Starts the OAuth flow for the account that will own every hub document. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.redirect(new URL("/no-access?need=admin", request.url));
  }
  if (!env.googleConfigured) {
    return NextResponse.redirect(new URL("/admin?error=google_not_configured", request.url));
  }
  const state = await createOAuthState("drive", "/admin");
  return NextResponse.redirect(await driveAuthUrl(state));
}
