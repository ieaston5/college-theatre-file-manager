import type { OrgConfig } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";

/** The single OrgConfig row, created on demand. */
export async function getConfig(): Promise<OrgConfig> {
  const existing = await prisma.orgConfig.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.orgConfig.create({ data: { id: "singleton" } });
}

export async function getDriveAccount() {
  return prisma.driveAccount.findUnique({ where: { id: "singleton" } });
}

/** Everything a page needs to decide whether to nag about setup. */
export async function getSetupState() {
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
    groupConfigured: Boolean(config.groupEmail),
    categoryCount,
    memberCount,
  };
}
