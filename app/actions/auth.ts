"use server";

import { redirect } from "next/navigation";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

/**
 * Sign out.
 *
 * A server action rather than a plain POST route so that Next's action
 * handling checks the request's origin for us. A bare `POST /api/auth/signout`
 * can be triggered by a form on any other site — harmless in itself, but it
 * lets somebody log a member out mid-edit, and there is no reason to leave it
 * open when the fix is free.
 */
export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({ actor: user, action: "auth.logout", summary: `${user.email} signed out` });
  }
  await clearSession();
  redirect("/login?signed_out=1");
}
