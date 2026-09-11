import { cache } from "react";
import type { OrgConfig } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { DRIVE_SCOPES } from "./constants";

/**
 * The single OrgConfig row, created on demand.
 *
 * Memoised per request: the app layout reads it for the org name and footer,
 * and the page inside it usually reads it again.
 */
export const getConfig = cache(async function getConfig(): Promise<OrgConfig> {
  const existing = await prisma.orgConfig.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.orgConfig.create({ data: { id: "singleton" } });
});

export const getDriveAccount = cache(async function getDriveAccount() {
  return prisma.driveAccount.findUnique({ where: { id: "singleton" } });
});

/**
 * Which scopes this build wants that the stored grant is missing.
 *
 * Google records `email` as `.../auth/userinfo.email`, so the two spellings
 * are treated as the same thing rather than nagging forever about a scope that
 * is actually there.
 */
export function missingDriveScopes(granted: string | null): string[] {
  if (!granted) return [];
  const held = new Set(granted.split(/\s+/).filter(Boolean));
  const alias = (scope: string) =>
    scope === "email" ? "https://www.googleapis.com/auth/userinfo.email" : scope;
  return DRIVE_SCOPES.filter((scope) => !held.has(scope) && !held.has(alias(scope)));
}

/** Human labels for the scopes worth naming in the admin console. */
export const SCOPE_LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/drive": "Drive files",
  "https://www.googleapis.com/auth/documents": "Docs",
  "https://www.googleapis.com/auth/spreadsheets": "Sheets",
  "https://www.googleapis.com/auth/presentations": "Slides",
  "https://www.googleapis.com/auth/forms.body": "Forms",
  "https://www.googleapis.com/auth/gmail.send": "sending email",
  openid: "sign-in",
  email: "the account's address",
};

/** Everything a page needs to decide whether to nag about setup. */
export const getSetupState = cache(async function getSetupState() {
  const [config, account, categoryCount, memberCount] = await Promise.all([
    getConfig(),
    getDriveAccount(),
    prisma.category.count({ where: { archived: false } }),
    prisma.user.count({ where: { status: { not: "DISABLED" } } }),
  ]);

  /**
   * "Connected" has to mean the hub can actually talk to Drive.
   *
   * A root folder id alone used to be enough, which quietly lied in one real
   * case: seeding while the hub was in simulated mode writes an account row
   * with mock folder ids and no token, so the admin page claimed a connection
   * to a placeholder address while every document creation failed. In Google
   * mode the refresh token is the only thing that means anything.
   */
  const driveConnected =
    env.driveMode === "google"
      ? Boolean(account?.refreshToken)
      : Boolean(account?.refreshToken || account?.rootFolderId);

  return {
    config,
    account,
    driveConnected,
    /** An account row that cannot be used — left over from the simulation. */
    driveAccountIsSimulated:
      env.driveMode === "google" && Boolean(account) && !account?.refreshToken,
    /**
     * Scopes this build needs that the stored grant does not have.
     *
     * Adding a capability to the hub means asking Google for another scope,
     * and a token granted before that knows nothing about it — the call simply
     * fails later with a permissions error that names nothing useful. Whoever
     * upgraded needs to know to press Reconnect, so say so up front.
     */
    missingScopes: missingDriveScopes(account?.scope ?? null),
    groupConfigured: Boolean(config.groupEmail),
    categoryCount,
    memberCount,
  };
});
