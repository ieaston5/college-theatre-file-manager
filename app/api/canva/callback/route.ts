import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { exchangeCanvaCode, saveCanvaCredentials } from "@/lib/canva/oauth";
import { atLeast } from "@/lib/constants";

/**
 * Canva's OAuth callback.
 *
 * Unlike the Google callbacks, this one must not rely on the session cookie:
 * Canva refuses `localhost` redirect URIs, so the browser can arrive here on
 * 127.0.0.1 where a cookie set on localhost is not sent. The single-use state
 * row carries the admin who started the flow, and is verified before use.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appUrl = env.appUrl.replace(/\/$/, "");

  const fail = (reason: string) =>
    NextResponse.redirect(`${appUrl}/admin?error=${encodeURIComponent(reason)}`);

  if (params.get("error")) return fail(params.get("error")!);

  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return fail("Canva did not send back a code.");

  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.purpose !== "canva" || !row.codeVerifier || !row.userId) {
    return fail("That Canva sign-in link has expired. Start again from Admin.");
  }
  await prisma.oAuthState.delete({ where: { state } }).catch(() => {});
  if (row.createdAt.getTime() < Date.now() - 60 * 60 * 1000) {
    return fail("That Canva sign-in link has expired. Start again from Admin.");
  }

  const initiator = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!initiator || !atLeast(initiator.role, "ADMIN") || initiator.status === "DISABLED") {
    return fail("Only an admin can connect the Canva account.");
  }

  try {
    const tokens = await exchangeCanvaCode(code, row.codeVerifier);

    // Best effort: label the connection with the Canva profile, and record the
    // account's capabilities so plan-gated features can be explained later.
    let profile: { displayName?: string | null } = {};
    let capabilities: string[] | undefined;
    try {
      const [profileResponse, capabilityResponse] = await Promise.all([
        fetch("https://api.canva.com/rest/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }),
        fetch("https://api.canva.com/rest/v1/users/me/capabilities", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }),
      ]);
      if (profileResponse.ok) {
        const body = (await profileResponse.json()) as { display_name?: string };
        profile = { displayName: body.display_name ?? null };
      }
      if (capabilityResponse.ok) {
        const body = (await capabilityResponse.json()) as { capabilities?: string[] };
        capabilities = body.capabilities;
      }
    } catch {
      /* the connection is still usable without the label */
    }

    await saveCanvaCredentials({
      tokens,
      connectedByUserId: initiator.id,
      profile,
      capabilities,
    });

    await recordAudit({
      actor: initiator,
      action: "canva.connect",
      summary: `Connected ${profile.displayName ?? "the hub's Canva account"} for Canva exports`,
      metadata: { scope: tokens.scope ?? null, capabilities: capabilities ?? [] },
    });

    return NextResponse.redirect(`${appUrl}/admin?canva_connected=1`);
  } catch (error) {
    console.error("[canva] connect failed", error);
    return fail(error instanceof Error ? error.message : "Could not connect Canva.");
  }
}
