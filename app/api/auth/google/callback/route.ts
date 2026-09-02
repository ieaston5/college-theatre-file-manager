import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { issueSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { consumeOAuthState, exchangeLoginCode } from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }

  const stateRow = await consumeOAuthState(params.get("state"), "login");
  if (!stateRow) {
    return NextResponse.redirect(new URL("/login?error=state_expired", request.url));
  }

  const code = params.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", request.url));

  let identity;
  try {
    identity = await exchangeLoginCode(code);
  } catch (cause) {
    console.error("[auth] google exchange failed", cause);
    return NextResponse.redirect(new URL("/login?error=exchange_failed", request.url));
  }

  const existing = await prisma.user.findUnique({ where: { email: identity.email } });
  const isBootstrapAdmin = env.bootstrapAdminEmails.includes(identity.email);

  // The access gate: no row (and not a bootstrap admin) means no dashboard.
  if (!existing && !isBootstrapAdmin) {
    await recordAudit({
      action: "auth.login.denied",
      summary: `Sign-in refused for ${identity.email} — not on the member list`,
      metadata: { email: identity.email },
    });
    return NextResponse.redirect(
      new URL(`/no-access?email=${encodeURIComponent(identity.email)}`, request.url),
    );
  }

  if (existing?.status === "DISABLED") {
    await recordAudit({
      actor: existing,
      action: "auth.login.denied",
      summary: `Sign-in refused for ${identity.email} — account disabled`,
    });
    return NextResponse.redirect(
      new URL(`/no-access?email=${encodeURIComponent(identity.email)}&reason=disabled`, request.url),
    );
  }

  const user = await prisma.user.upsert({
    where: { email: identity.email },
    create: {
      email: identity.email,
      name: identity.name ?? null,
      avatarUrl: identity.picture ?? null,
      googleSub: identity.sub,
      role: isBootstrapAdmin ? "ADMIN" : "MEMBER",
      status: "ACTIVE",
      lastLoginAt: new Date(),
    },
    update: {
      name: existing?.name ?? identity.name ?? null,
      avatarUrl: identity.picture ?? existing?.avatarUrl ?? null,
      googleSub: identity.sub,
      status: "ACTIVE",
      role: isBootstrapAdmin && existing?.role !== "ADMIN" ? "ADMIN" : existing?.role,
      lastLoginAt: new Date(),
    },
  });

  await issueSession(user.id);
  await recordAudit({ actor: user, action: "auth.login", summary: `${user.email} signed in` });

  const next = stateRow.redirect && stateRow.redirect.startsWith("/") ? stateRow.redirect : "/";
  return NextResponse.redirect(new URL(next, request.url));
}
