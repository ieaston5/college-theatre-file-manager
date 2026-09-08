import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { issueSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { callerKey, rateLimit, rateLimitClear } from "@/lib/rate-limit";

/**
 * Local-only shortcut so the hub can be evaluated without a Google project.
 * Guarded by ALLOW_DEV_LOGIN and disabled outright in production builds.
 */
export async function POST(request: NextRequest) {
  if (!env.allowDevLogin) {
    return NextResponse.redirect(new URL("/login?error=dev_login_disabled", request.url));
  }

  const limit = await rateLimit("login", callerKey(request.headers));
  if (!limit.ok) {
    return NextResponse.redirect(new URL("/login?error=rate_limited", request.url));
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return NextResponse.redirect(new URL("/login?error=missing_email", request.url));

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user && env.bootstrapAdminEmails.includes(email)) {
    user = await prisma.user.create({
      data: { email, role: "ADMIN", status: "ACTIVE", name: email.split("@")[0] },
    });
  }
  if (!user || user.status === "DISABLED") {
    return NextResponse.redirect(
      new URL(`/no-access?email=${encodeURIComponent(email)}`, request.url),
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { status: "ACTIVE", lastLoginAt: new Date() },
  });
  await issueSession(user.id);
  await rateLimitClear("login", callerKey(request.headers));
  await recordAudit({
    actor: user,
    action: "auth.login",
    summary: `${user.email} signed in (local dev login)`,
  });

  return NextResponse.redirect(new URL("/", request.url));
}
