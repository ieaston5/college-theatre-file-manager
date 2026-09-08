import { prisma } from "../db";
import { env } from "../env";
import { CanvaConnectProvider, canvaDesignUrl } from "./real";
import { MockCanvaProvider } from "./mock";
import { CanvaNotConnectedError, type CanvaProvider } from "./types";

export * from "./types";
export { canvaDesignUrl };

export function canvaProvider(): CanvaProvider {
  if (env.canvaMode === "off") throw new CanvaNotConnectedError();
  return env.canvaMode === "canva" ? new CanvaConnectProvider() : new MockCanvaProvider();
}

export function canvaEnabled() {
  return env.canvaMode !== "off";
}

export function isMockCanva() {
  return env.canvaMode === "mock";
}

export async function getCanvaAccount() {
  return prisma.canvaAccount.findUnique({ where: { id: "singleton" } });
}

/** Whether the hub can actually reach Canva right now. */
export async function canvaReady(): Promise<boolean> {
  if (env.canvaMode === "off") return false;
  if (env.canvaMode === "mock") return true;
  const account = await getCanvaAccount();
  return Boolean(account?.refreshToken);
}

/**
 * Pull a design id out of anything somebody might paste.
 *
 * Canva share links look like https://www.canva.com/design/DAF.../view?utm=…
 * and the editor URL ends /edit. Short canva.link/ URLs are redirects, so
 * they are followed once to find the real one.
 */
export function extractCanvaDesignId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/canva\.com\/design\/([A-Za-z0-9_-]{6,})/);
  if (match) return match[1];
  // A bare design id, as shown in the Canva URL bar.
  if (/^DA[A-Za-z0-9_-]{6,}$/.test(trimmed)) return trimmed;
  return null;
}

export function isCanvaShortLink(input: string): boolean {
  return /^https?:\/\/(www\.)?canva\.link\//i.test(input.trim());
}

/** Follow a canva.link short URL to the real design URL. */
export async function resolveCanvaShortLink(input: string): Promise<string | null> {
  try {
    const response = await fetch(input.trim(), { redirect: "follow" });
    return response.url ?? null;
  } catch {
    return null;
  }
}
