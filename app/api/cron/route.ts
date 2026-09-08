import { NextResponse, type NextRequest } from "next/server";
import { runScheduledJobs } from "@/lib/cron";
import { callerKey, rateLimit } from "@/lib/rate-limit";

/**
 * The scheduled entry point, called hourly by the host (see vercel.json).
 *
 * Guarded by CRON_SECRET rather than a session, because there is no user
 * behind it. Vercel Cron sends the secret as a bearer token; a query parameter
 * is accepted too so the job can be triggered by hand or from another
 * scheduler. Without the secret set the route refuses to run at all, so an
 * unconfigured deployment cannot have its jobs poked by strangers.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("key") === secret;
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    // Guessing the secret should be slow and obvious, not free and quiet.
    const limit = await rateLimit("cron", callerKey(request.headers));
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many attempts." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    return NextResponse.json(
      {
        error: process.env.CRON_SECRET
          ? "Not authorised."
          : "CRON_SECRET is not set, so scheduled jobs are disabled.",
      },
      { status: 401 },
    );
  }

  try {
    const report = await runScheduledJobs();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...report });
  } catch (error) {
    console.error("[cron] failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
