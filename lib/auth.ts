import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { atLeast, type Role } from "./constants";

const COOKIE = "pph_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // two weeks

function secret() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function issueSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in user, or null. The row is re-read on every request so that
 * disabling someone in the admin console takes effect immediately.
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  let uid: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    uid = String(payload.uid ?? "");
  } catch {
    return null;
  }
  if (!uid) return null;

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || user.status === "DISABLED") return null;
  return user;
}

/** Use in every authenticated page/action. Redirects to the sign-in screen. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(min: Role): Promise<User> {
  const user = await requireUser();
  if (!atLeast(user.role, min)) redirect("/no-access?need=" + min.toLowerCase());
  return user;
}

/** For server actions: throw rather than redirect, so the form can show it. */
export async function assertRole(min: Role): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Reload the page and sign in again.");
  if (!atLeast(user.role, min)) {
    throw new Error("You do not have permission to do that.");
  }
  return user;
}

/**
 * The guard for anything that files a document. Board members always pass; a
 * company member passes only if one of their production roles allows filing.
 * The envelope of *what* they may file — which categories, which shows, which
 * visibility — is enforced by assertCreationAllowed in lib/documents.
 */
export async function assertCanCreate() {
  const { getViewerContext, canCreateDocuments } = await import("./access");
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Reload the page and sign in again.");
  const viewer = await getViewerContext(user);
  if (!canCreateDocuments(viewer)) {
    throw new Error("You do not have permission to add documents to the hub.");
  }
  // Every document filed here means Drive writes and a handful of sharing
  // calls, all against the hub account's quota. This is the one place all the
  // creation paths pass through, so the leash goes here.
  const { rateLimit, tooManyMessage } = await import("./rate-limit");
  const limit = await rateLimit("documentCreate", user.id);
  if (!limit.ok) throw new Error(tooManyMessage(limit, "new documents"));
  return { user, viewer };
}

export function isAdmin(user: Pick<User, "role"> | null | undefined) {
  return Boolean(user && atLeast(user.role, "ADMIN"));
}
