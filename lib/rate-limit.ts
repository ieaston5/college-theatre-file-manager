import { prisma } from "./db";

/**
 * Fixed-window rate limiting, stored in the database.
 *
 * An in-memory counter would be the obvious choice, but this app is meant to
 * run on serverless hosting where each request may land in a fresh process —
 * an in-memory limit there protects nothing. A row per key per window is a
 * little slower and completely reliable.
 *
 * The window is fixed rather than sliding, which means a caller can in theory
 * get 2× the limit by straddling a boundary. That is fine: the point is to stop
 * somebody hammering the login route or filling the audit log, not to meter
 * paid API calls to the request.
 */

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** When the current window ends, so callers can say how long to wait. */
  resetAt: Date;
  retryAfterSeconds: number;
};

export type RateLimitRule = { limit: number; windowSeconds: number };

/** The limits, in one place so they can be read at a glance. */
export const LIMITS = {
  /** Sign-in attempts from one address. Generous — people mistype. */
  login: { limit: 10, windowSeconds: 10 * 60 },
  /** Starting an OAuth round trip. */
  oauthStart: { limit: 20, windowSeconds: 10 * 60 },
  /** Asking for access to a document. Stops the requests table being flooded. */
  accessRequest: { limit: 15, windowSeconds: 60 * 60 },
  /** Opening an upload session. Each one is a Drive call. */
  uploadStart: { limit: 60, windowSeconds: 10 * 60 },
  /** Creating documents, which means a Drive write plus sharing calls. */
  documentCreate: { limit: 60, windowSeconds: 10 * 60 },
  /**
   * Mailing the whole company at once. The hub sends through a single Gmail
   * account with a real daily cap, so this is deliberately tight — a test
   * digest to yourself is not counted.
   */
  emailSend: { limit: 5, windowSeconds: 60 * 60 },
  /** Unauthorised hits on the cron endpoint. */
  cron: { limit: 30, windowSeconds: 10 * 60 },
} satisfies Record<string, RateLimitRule>;

export type LimitName = keyof typeof LIMITS;

function windowStart(windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms);
}

/**
 * Count one hit against `key` and say whether it is allowed.
 *
 * Never throws: if the counter itself fails, the request is allowed through.
 * A broken limiter should not be able to take the hub down.
 */
export async function rateLimit(
  name: LimitName,
  key: string,
  overrides?: Partial<RateLimitRule>,
): Promise<RateLimitResult> {
  const rule = { ...LIMITS[name], ...overrides };
  const windowAt = windowStart(rule.windowSeconds);
  const resetAt = new Date(windowAt.getTime() + rule.windowSeconds * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  const bucket = `${name}:${key}`;

  try {
    const row = await prisma.rateLimit.upsert({
      where: { bucket_windowAt: { bucket, windowAt } },
      create: { bucket, windowAt, count: 1 },
      update: { count: { increment: 1 } },
    });

    // Opportunistic cleanup, rarely and cheaply, so no separate job is needed.
    if (row.count === 1 && Math.random() < 0.02) void sweepOldWindows();

    return {
      ok: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      resetAt,
      retryAfterSeconds,
    };
  } catch (error) {
    console.error("[rate-limit] counter unavailable, allowing request", error);
    return { ok: true, remaining: rule.limit, resetAt, retryAfterSeconds };
  }
}

/** Read the current count without adding to it. */
export async function rateLimitPeek(name: LimitName, key: string): Promise<RateLimitResult> {
  const rule = LIMITS[name];
  const windowAt = windowStart(rule.windowSeconds);
  const resetAt = new Date(windowAt.getTime() + rule.windowSeconds * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  try {
    const row = await prisma.rateLimit.findUnique({
      where: { bucket_windowAt: { bucket: `${name}:${key}`, windowAt } },
    });
    const count = row?.count ?? 0;
    return {
      ok: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      retryAfterSeconds,
    };
  } catch {
    return { ok: true, remaining: rule.limit, resetAt, retryAfterSeconds };
  }
}

/** Forget a caller's hits — used after a successful sign-in. */
export async function rateLimitClear(name: LimitName, key: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { bucket: `${name}:${key}` } });
  } catch {
    // A stuck counter expires on its own; nothing to do here.
  }
}

async function sweepOldWindows(): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({
      where: { windowAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  } catch {
    // Harmless if it fails; the next hit will try again.
  }
}

/**
 * The caller's address, as best it can be known behind a proxy.
 *
 * On Vercel `x-forwarded-for` is set by the platform and cannot be spoofed by
 * the client. Elsewhere it can be, so this is a speed bump rather than a
 * security boundary — which is why the per-user limits below key on the user id
 * instead wherever there is a session.
 */
export function callerKey(headers: Headers, fallback = "unknown"): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? fallback;
}

/** A friendly "slow down" message with the wait rounded to something readable. */
export function tooManyMessage(result: RateLimitResult, what: string): string {
  const seconds = result.retryAfterSeconds;
  const wait =
    seconds < 90
      ? `${seconds} seconds`
      : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? "" : "s"}`;
  return `Too many ${what} in a row. Try again in about ${wait}.`;
}

/**
 * Throwing form, for use inside server actions where the surrounding
 * try/catch turns errors into form banners.
 */
export async function assertWithinLimit(
  name: LimitName,
  key: string,
  what: string,
): Promise<void> {
  const result = await rateLimit(name, key);
  if (!result.ok) throw new Error(tooManyMessage(result, what));
}
