import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createOAuthState, loginAuthUrl } from "@/lib/google/oauth";
import { callerKey, rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  if (!env.googleConfigured) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }
  // Each round trip writes an OAuthState row; without a limit this is a free
  // way to fill the table.
  const limit = await rateLimit("oauthStart", callerKey(request.headers));
  if (!limit.ok) {
    return NextResponse.redirect(new URL("/login?error=rate_limited", request.url));
  }
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const state = await createOAuthState("login", next.startsWith("/") ? next : "/");
  return NextResponse.redirect(loginAuthUrl(state));
}
