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
    /** The shared drive it belongs to, when it belongs to one. */
    driveId: string | null;
    driveName: string | null;
  } | null;
  children: { total: number; sample: Array<{ name: string; mimeType: string }> };
  sharedFolders: Array<{ id: string; name: string; sharedWithMeTime: string | null }>;
  /**
   * Shared drives the hub's account is a member of.
   *
   * Listed separately because Drive does not consider a shared drive to be
   * "shared with" anybody: it never appears under sharedWithMe, so a hub that
   * only asked that question would report "nothing is shared with this
   * address" to somebody looking straight at a drive full of files.
   */
  sharedDrives: Array<{ id: string; name: string; canListChildren: boolean | null }>;
  /** Plain-language reading of the above. */
  verdict: string;
  hint: string | null;
};

export async function diagnoseFolder(actor: User, folderId: string): Promise<DriveDiagnosis> {
  const provider = driveProvider();
  const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
  const askedAs = account?.email ?? null;

  const info = await provider.getFile(folderId).catch(() => null);

  const sharedDrives = await provider
    .listSharedDrives(50)
    .then((drives) =>
      drives.map((drive) => ({
        id: drive.id,
        name: drive.name,
        canListChildren: drive.canListChildren,
      })),
    )
    .catch(() => []);

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
        driveId: info.driveId ?? null,
        driveName: info.driveId
          ? (sharedDrives.find((drive) => drive.id === info.driveId)?.name ?? null)
          : null,
      }
    : null;

  const entries = info
    ? await provider.listFolder(folderId, { driveId: info.driveId }).catch(() => [])
    : [];
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

  const inSharedDrive = Boolean(folder?.driveId);
  const driveLabel = folder?.driveName
    ? `the “${folder.driveName}” shared drive`
    : "a shared drive";

  if (!folder) {
    verdict = `${askedAs ?? "The hub account"} cannot read that id at all.`;
    hint =
      sharedDrives.length > 0
        ? `Either the id is wrong, or nothing has been shared with that address. That account is a member of ${sharedDrives
            .slice(0, 6)
            .map((drive) => `“${drive.name}”`)
            .join(", ")}${sharedDrives.length > 6 ? ", …" : ""} — if the folder is in a shared drive it is not a member of, adding it to the drive is the fix, not sharing the folder.`
        : "Either the id is wrong, or nothing has been shared with that address.";
  } else if (folder.shortcutTargetId) {
    verdict = "That id is a shortcut, not the folder itself.";
    hint = `It points at ${folder.shortcutTargetId} — scan that instead, or use the original folder's own link.`;
  } else if (folder.mimeType !== "application/vnd.google-apps.folder") {
    verdict = `That id is a ${folder.mimeType}, not a folder.`;
  } else if (entries.length > 0) {
    verdict = `Readable, and Drive lists ${entries.length} ${
      entries.length === 1 ? "item" : "items"
    } inside it${inSharedDrive ? `, in ${driveLabel}` : ""}. An import should work.`;
    if (inSharedDrive) {
      hint =
        "Files in a shared drive are owned by the drive rather than by a person, so importing them leaves nothing to chase afterwards.";
    }
  } else if (folder.canListChildren === false) {
    verdict = inSharedDrive
      ? `In ${driveLabel}, which the hub account can see, but it may not list what is inside this folder.`
      : "Shared with the hub account, but this account may not list what is inside it.";
    hint = inSharedDrive
      ? "A Viewer on a shared drive can normally list everything in it, so this is usually a folder with its own restricted access. Give the hub's address access to the folder, or raise its role on the drive."
      : "Give the address Viewer access on the folder rather than on the files.";
  } else if (inSharedDrive) {
    /**
     * Must be checked before the link-only test below. Nothing in a shared
     * drive is ownedByMe and nothing has a sharedWithMeTime — the account is
     * a member of the drive, it was never "shared with" anything — so that
     * test calls every healthy shared drive a link-only share and sends
     * people off to re-share a folder that is already correct.
     */
    verdict = `In ${driveLabel}, readable by the hub account, and Drive says there is nothing inside it.`;
    hint = `Sign in as ${askedAs}, open that drive, and look: members of a shared drive all see the same contents, so whatever it shows is exactly what the hub sees.`;
  } else if (folder.ownedByMe === false && !folder.sharedWithMeTime) {
    verdict =
      "Readable by id, but Drive does not record it as shared with the hub account — which is what a link-only share looks like. Contents of a folder reached that way cannot be listed.";
    hint = `Open the folder in Drive, press Share, and add ${askedAs} as a Viewer.`;
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
    sharedDrives,
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
