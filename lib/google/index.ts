import type { Category, Production } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { getConfig } from "../config";
import { STANDING_BUCKET } from "../constants";
import { GoogleDriveProvider } from "./real";
import { MockDriveProvider } from "./mock";
import type { DriveProvider } from "./types";

export * from "./types";

let cached: { mode: string; provider: DriveProvider } | null = null;

/** The Drive implementation for the current DRIVE_MODE. */
export function driveProvider(): DriveProvider {
  const mode = env.driveMode;
  if (cached?.mode === mode) return cached.provider;
  const provider: DriveProvider =
    mode === "google" ? new GoogleDriveProvider() : new MockDriveProvider();
  cached = { mode, provider };
  return provider;
}

export function isMockDrive() {
  return env.driveMode === "mock";
}

/**
 * Make sure the folder skeleton exists and is recorded:
 *
 *   <root>/
 *     Productions/<Show>/<Category>
 *     Organisation-wide/<Category>
 */
export async function ensureRootFolders() {
  const provider = driveProvider();
  const config = await getConfig();
  let account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });

  if (!account) {
    if (provider.mode === "google") {
      const { GoogleNotConnectedError } = await import("./types");
      throw new GoogleNotConnectedError();
    }
    account = await prisma.driveAccount.create({
      data: {
        id: "singleton",
        email: (await provider.accountEmail()) ?? "mock-drive@localhost",
        name: "Mock Drive (local evaluation)",
      },
    });
  }

  const rootFolderId = account.rootFolderId ?? (await provider.ensureFolder(config.driveRootName));
  const productionsFolderId =
    account.productionsFolderId ?? (await provider.ensureFolder("Productions", rootFolderId));
  const standingFolderId =
    account.standingFolderId ?? (await provider.ensureFolder(STANDING_BUCKET, rootFolderId));

  if (
    account.rootFolderId !== rootFolderId ||
    account.productionsFolderId !== productionsFolderId ||
    account.standingFolderId !== standingFolderId
  ) {
    account = await prisma.driveAccount.update({
      where: { id: "singleton" },
      data: { rootFolderId, productionsFolderId, standingFolderId },
    });
  }

  return { account, rootFolderId, productionsFolderId, standingFolderId };
}

/** The Drive folder a document with this category/production belongs in. */
export async function resolveFolder(options: {
  category: Pick<Category, "name" | "folderName">;
  production?: Pick<Production, "id" | "name" | "driveFolderId"> | null;
}): Promise<string> {
  const provider = driveProvider();
  const { productionsFolderId, standingFolderId } = await ensureRootFolders();
  const categoryFolderName = options.category.folderName?.trim() || options.category.name;

  if (options.production) {
    let showFolderId = options.production.driveFolderId;
    if (!showFolderId) {
      showFolderId = await provider.ensureFolder(options.production.name, productionsFolderId);
      await prisma.production.update({
        where: { id: options.production.id },
        data: { driveFolderId: showFolderId },
      });
    }
    return provider.ensureFolder(categoryFolderName, showFolderId);
  }

  return provider.ensureFolder(categoryFolderName, standingFolderId);
}

/** Folder for a production itself (used when a show is created). */
export async function ensureProductionFolder(production: Pick<Production, "id" | "name" | "driveFolderId">) {
  if (production.driveFolderId) return production.driveFolderId;
  const provider = driveProvider();
  const { productionsFolderId } = await ensureRootFolders();
  const folderId = await provider.ensureFolder(production.name, productionsFolderId);
  await prisma.production.update({ where: { id: production.id }, data: { driveFolderId: folderId } });
  return folderId;
}
