import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createOAuthState, loginAuthUrl } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  if (!env.googleConfigured) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const state = await createOAuthState("login", next.startsWith("/") ? next : "/");
  return NextResponse.redirect(loginAuthUrl(state));
}
