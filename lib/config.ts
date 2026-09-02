import type { OrgConfig } from "@prisma/client";
import { prisma } from "./db";

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

  return {
    config,
    account,
    driveConnected: Boolean(account?.refreshToken || account?.rootFolderId),
    groupConfigured: Boolean(config.groupEmail),
    categoryCount,
    memberCount,
  };
}
