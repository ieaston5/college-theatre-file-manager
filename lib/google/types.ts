import type { AccessLevel, CreatableDocType, Visibility } from "../constants";

export type DriveFileInfo = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  iconLink?: string | null;
  ownerEmail?: string | null;
  modifiedTime?: string | null;
  parents?: string[];
  trashed?: boolean;
  sizeBytes?: number | null;
  /** Hub metadata stored on the file itself; used to verify uploads. */
  appProperties?: Record<string, string> | null;
  /** Set when this "folder" is really a shortcut to one somewhere else. */
  shortcutTargetId?: string | null;
  /**
   * The shared drive this item lives in. Absent for My Drive.
   *
   * Worth carrying everywhere, because almost every "is this shared with us"
   * signal below reads differently inside a shared drive: nothing there is
   * ownedByMe, nothing has a sharedWithMeTime, and no file has an owner.
   * Without this the hub would diagnose a perfectly healthy shared drive as a
   * link-only share.
   */
  driveId?: string | null;
  /** Whether this account may enumerate the folder. null when unknown. */
  canListChildren?: boolean | null;
  /** Whether the hub's own account owns this. null when unknown. */
  ownedByMe?: boolean | null;
  /**
   * When the file was shared *with* this account. Absent means access came
   * some other way — usually a link — which is the case where a folder can be
   * fetched by id but its contents cannot be listed.
   */
  sharedWithMeTime?: string | null;
  /**
   * Forms only: the link people fill in, as opposed to the edit link. Google
   * keeps these separate and sharing the edit link by mistake lets responders
   * change the questions.
   */
  formResponderUrl?: string | null;
};

/**
 * A shared drive the hub's account is a member of.
 *
 * Shared drives are not "shared with" an account the way a folder is, so they
 * never appear in listSharedFolders and there is no link to paste for them
 * until somebody goes and finds one. Listing them is how an import can start
 * from "what can the hub see?" rather than "what is the id?".
 */
export type SharedDriveInfo = {
  id: string;
  name: string;
  /** Whether the hub's account may enumerate the drive. null when unknown. */
  canListChildren: boolean | null;
  createdTime: string | null;
};

export type DocHeader = {
  title: string;
  production?: string | null;
  category: string;
  owner: string;
  visibility: Visibility;
  createdAt: Date;
  hubUrl: string;
  orgName: string;
};

export type CreateDocumentInput = {
  name: string;
  docType: CreatableDocType;
  parentFolderId: string | null;
  /** When set, the new file is a copy of this template instead of a blank file. */
  templateFileId?: string | null;
  description?: string | null;
  appProperties?: Record<string, string>;
  header?: DocHeader | null;
};

export type SharingPlan = {
  visibility: Visibility;
  /** Always kept as an editor so the creator can find the file in Drive. */
  creatorEmail: string;
  /**
   * The board's old Google Group, which is never granted anything any more.
   * It is named here so a pass over a file can take the permission back off
   * one that was shared with the group before the hub moved to naming each
   * board member — otherwise that access would outlive every member list.
   */
  retireGroupEmail?: string | null;
  /** Everyone the file is shared with by name: the board, the company, and
   * any individual grants layered on top. */
  extra?: Array<{ email: string; level: AccessLevel }>;
  /**
   * "reconcile" makes the file's permissions exactly match the plan — correct
   * for files the hub created and owns.
   *
   * "additive" grants what is missing and only ever revokes the old board
   * group. Used for pre-existing files owned by a member, where blindly
   * revoking unknown permissions would cut off the file's real collaborators.
   */
  strategy?: "reconcile" | "additive";
};

export type AppliedPermission = { email: string; level: AccessLevel; permissionId: string | null };

export type SharingResult = {
  granted: AppliedPermission[];
  revoked: string[];
  warnings: string[];
};

export interface DriveProvider {
  readonly mode: "google" | "mock";
  /** The account that owns everything the hub creates. */
  accountEmail(): Promise<string | null>;
  /** Idempotent: returns the existing folder id when one already matches. */
  ensureFolder(name: string, parentId?: string | null): Promise<string>;
  createDocument(input: CreateDocumentInput): Promise<DriveFileInfo>;
  getFile(fileId: string): Promise<DriveFileInfo | null>;
  /**
   * Children of a folder.
   *
   * Pass the enclosing shared drive's id when the folder is in one: Drive's
   * default search corpus is the account's own, and naming the drive is both
   * the documented way to search inside it and considerably faster than
   * asking every drive at once.
   */
  listFolder(folderId: string, options?: { driveId?: string | null }): Promise<DriveFileInfo[]>;
  /** Shared drives the hub's account is a member of. */
  listSharedDrives(limit?: number): Promise<SharedDriveInfo[]>;
  /**
   * Folders that have been shared *with* the hub account.
   *
   * Diagnostic only: when an import finds nothing, the useful question is
   * whether Drive considers the folder shared with this account at all. If it
   * is not in this list, the address it was shared with is not the address the
   * hub is using — which no amount of re-scanning will reveal.
   */
  listSharedFolders(limit?: number): Promise<DriveFileInfo[]>;
  /**
   * Everything this account can see that Google says changed after `since`,
   * as ids and times only.
   *
   * The hub sorts and labels documents by when they were last edited, which
   * is a fact only Drive knows and which changes without the hub being told.
   * Asking per document would be one API call per row on every list; asking
   * Drive for the delta is one call for the lot, however big the hub is.
   */
  listModifiedSince(since: Date, limit?: number): Promise<Array<{ id: string; modifiedTime: string | null }>>;
  renameFile(fileId: string, name: string): Promise<void>;
  /**
   * Merge hub labels into the file's appProperties.
   *
   * These labels are how a file says which category, show and visibility it
   * belongs to, and they are the only thing scripts/rebuild-from-drive.ts has
   * to work from if the database is ever lost. They therefore have to be
   * updated when the hub's answer changes, not just when the file is created.
   */
  setAppProperties(fileId: string, properties: Record<string, string>): Promise<void>;
  moveFile(fileId: string, parentFolderId: string): Promise<void>;
  updateDescription(fileId: string, description: string): Promise<void>;
  trashFile(fileId: string): Promise<void>;
  /** Reconciles the file's permissions to exactly match the plan. */
  applySharing(fileId: string, plan: SharingPlan): Promise<SharingResult>;
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super(
      "The hub's Google account is not connected yet. An admin needs to connect it in Admin → Google connection.",
    );
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleCallError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "GoogleCallError";
  }
}
