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
  /** Shared with the board when visibility is BOARD. */
  groupEmail?: string | null;
  groupCanEdit: boolean;
  /** Individual grants layered on top (used for private documents). */
  extra?: Array<{ email: string; level: AccessLevel }>;
  /**
   * "reconcile" makes the file's permissions exactly match the plan — correct
   * for files the hub created and owns.
   *
   * "additive" grants what is missing and only ever revokes the board group.
   * Used for pre-existing files owned by a member, where blindly revoking
   * unknown permissions would cut off the file's real collaborators.
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
  listFolder(folderId: string): Promise<DriveFileInfo[]>;
  renameFile(fileId: string, name: string): Promise<void>;
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
