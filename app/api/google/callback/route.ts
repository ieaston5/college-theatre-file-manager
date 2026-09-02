import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { consumeOAuthState, exchangeDriveCode, saveDriveCredentials } from "@/lib/google/oauth";
import { ensureRootFolders } from "@/lib/google";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.redirect(new URL("/no-access?need=admin", request.url));
  }

  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return NextResponse.redirect(
      new URL(`/admin?error=${encodeURIComponent(params.get("error")!)}`, request.url),
    );
  }

  const stateRow = await consumeOAuthState(params.get("state"), "drive");
  if (!stateRow) return NextResponse.redirect(new URL("/admin?error=state_expired", request.url));

  const code = params.get("code");
  if (!code) return NextResponse.redirect(new URL("/admin?error=missing_code", request.url));

  try {
    const { tokens, email, name } = await exchangeDriveCode(code);
    await saveDriveCredentials({
      email,
      name,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token!,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
      connectedByUserId: user!.id,
    });

    // Build the folder skeleton straight away so the first document lands
    // somewhere sensible.
    const folders = await ensureRootFolders();
    await recordAudit({
      actor: user,
      action: "drive.connect",
      summary: `Connected ${email} as the hub's document owner`,
      metadata: { rootFolderId: folders.rootFolderId },
    });
    return NextResponse.redirect(new URL("/admin?connected=1", request.url));
  } catch (cause) {
    console.error("[google] drive connect failed", cause);
    const message = cause instanceof Error ? cause.message : "unknown_error";
    return NextResponse.redirect(
      new URL(`/admin?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
