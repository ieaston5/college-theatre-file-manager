import { prisma } from "../db";
import { driveProvider } from ".";
import { recordAudit } from "../audit";
import type { User } from "@prisma/client";

/**
 * Read-only interrogation of a Drive folder, from the hub's own account.
 *
 * When an import finds nothing there is no way to tell from the outside which
 * of several situations it is, and the person who can see the folder in their
 * browser is not the account doing the asking. This runs the questions worth
 * asking in one pass, as the hub account, and records the answers in the audit
 * log so they can be read later by whoever is helping — no credentials need to
 * leave the deployment.
 *
 * Strictly read-only: metadata reads and list queries, nothing written to
 * Drive.
 */
export type DriveDiagnosis = {
  askedAs: string | null;
  folder: {
    id: string;
    name: string | null;
    mimeType: string | null;
    ownedByMe: boolean | null;
    sharedWithMeTime: string | null;
    canListChildren: boolean | null;
    shortcutTargetId: string | null;
    ownerEmail: string | null;
    parents: string[];
  } | null;
  children: { total: number; sample: Array<{ name: string; mimeType: string }> };
  sharedFolders: Array<{ id: string; name: string; sharedWithMeTime: string | null }>;
  /** Plain-language reading of the above. */
  verdict: string;
  hint: string | null;
};

export async function diagnoseFolder(actor: User, folderId: string): Promise<DriveDiagnosis> {
  const provider = driveProvider();
  const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
  const askedAs = account?.email ?? null;

  const info = await provider.getFile(folderId).catch(() => null);

  const folder = info
    ? {
        id: info.id,
        name: info.name,
        mimeType: info.mimeType,
        ownedByMe: info.ownedByMe ?? null,
        sharedWithMeTime: info.sharedWithMeTime ?? null,
        canListChildren: info.canListChildren ?? null,
        shortcutTargetId: info.shortcutTargetId ?? null,
        ownerEmail: info.ownerEmail ?? null,
        parents: info.parents ?? [],
      }
    : null;

  const entries = info ? await provider.listFolder(folderId).catch(() => []) : [];
  const sharedFolders = await provider
    .listSharedFolders(25)
    .then((folders) =>
      folders.map((f) => ({
        id: f.id,
        name: f.name,
        sharedWithMeTime: f.sharedWithMeTime ?? null,
      })),
    )
    .catch(() => []);

  let verdict: string;
  let hint: string | null = null;

  if (!folder) {
    verdict = `${askedAs ?? "The hub account"} cannot read that id at all.`;
    hint = "Either the id is wrong, or nothing has been shared with that address.";
  } else if (folder.shortcutTargetId) {
    verdict = "That id is a shortcut, not the folder itself.";
    hint = `It points at ${folder.shortcutTargetId} — scan that instead, or use the original folder's own link.`;
  } else if (folder.mimeType !== "application/vnd.google-apps.folder") {
    verdict = `That id is a ${folder.mimeType}, not a folder.`;
  } else if (entries.length > 0) {
    verdict = `Readable, and Drive lists ${entries.length} ${
      entries.length === 1 ? "item" : "items"
    } inside it. An import should work.`;
  } else if (folder.ownedByMe === false && !folder.sharedWithMeTime) {
    verdict =
      "Readable by id, but Drive does not record it as shared with the hub account — which is what a link-only share looks like. Contents of a folder reached that way cannot be listed.";
    hint = `Open the folder in Drive, press Share, and add ${askedAs} as a Viewer.`;
  } else if (folder.canListChildren === false) {
    verdict = "Shared with the hub account, but this account may not list what is inside it.";
    hint = "Give the address Viewer access on the folder rather than on the files.";
  } else {
    verdict =
      "Shared with the hub account, allowed to list, and Drive says there is nothing inside.";
    hint = `Sign in to Drive as ${askedAs} and open the folder: whatever that account sees is exactly what the hub sees.`;
  }

  const diagnosis: DriveDiagnosis = {
    askedAs,
    folder,
    children: {
      total: entries.length,
      sample: entries.slice(0, 10).map((e) => ({ name: e.name, mimeType: e.mimeType })),
    },
    sharedFolders,
    verdict,
    hint,
  };

  await recordAudit({
    actor,
    action: "drive.diagnose",
    targetType: "DriveFolder",
    targetId: folderId,
    summary: `Diagnosed Drive folder access — ${verdict}`,
    metadata: diagnosis as unknown as Record<string, unknown>,
  });

  return diagnosis;
}
