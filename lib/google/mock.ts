import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DOC_TYPE_META } from "../constants";
import {
  type AppliedPermission,
  type CreateDocumentInput,
  type DriveFileInfo,
  type DriveProvider,
  type SharingPlan,
  type SharingResult,
} from "./types";

/**
 * A stand-in for Google Drive so the whole hub — creation, folder tree,
 * sharing rules, visibility flips — can be exercised before anyone connects a
 * real Google account. State lives in .mock-drive/files.json and every file
 * gets a browsable page at /mock-drive/<id> that shows who it is shared with.
 */

type MockPermission = { id: string; email: string; role: "reader" | "writer" | "owner"; type: string };

type MockFile = {
  id: string;
  name: string;
  mimeType: string;
  description?: string | null;
  parents: string[];
  appProperties?: Record<string, string>;
  createdTime: string;
  modifiedTime: string;
  trashed: boolean;
  permissions: MockPermission[];
  headerPreview?: string | null;
  fromTemplate?: string | null;
  /** Uploaded files: real bytes on disk under .mock-drive/blobs, so the
   *  simulated Drive can actually preview and download them. */
  sizeBytes?: number;
  blobFile?: string;
  revisions?: number;
  /** Simulates "Add shortcut to Drive": this file points at another. */
  shortcutTargetId?: string | null;
  /** Simulates a folder this account may see but not enumerate. */
  canListChildren?: boolean;
};

type MockState = { accountEmail: string; files: Record<string, MockFile> };

const STORE_DIR = path.join(process.cwd(), ".mock-drive");
const STORE_FILE = path.join(STORE_DIR, "files.json");
const MOCK_ACCOUNT = "pennplayers.hub@example.com";

function load(): MockState {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as MockState;
    if (parsed && typeof parsed === "object" && parsed.files) return parsed;
  } catch {
    // fall through to a fresh store
  }
  return { accountEmail: MOCK_ACCOUNT, files: {} };
}

function save(state: MockState) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  // Write-then-rename: several requests can be mutating this store at once,
  // and a reader must never catch a half-written file — a truncated read would
  // look like an empty store and silently wipe the simulation.
  const temporary = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, STORE_FILE);
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

function toInfo(file: MockFile): DriveFileInfo {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: `/mock-drive/${file.id}`,
    iconLink: null,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
    trashed: file.trashed,
    ownerEmail: file.permissions.find((perm) => perm.role === "owner")?.email ?? MOCK_ACCOUNT,
    sizeBytes: file.sizeBytes ?? null,
    appProperties: file.appProperties ?? null,
    // Simulated shortcuts, so the import path that follows them can be
    // exercised without a real Drive.
    shortcutTargetId: file.shortcutTargetId ?? null,
    canListChildren: file.canListChildren ?? true,
  };
}

/** Used by the /mock-drive viewer page. */
export function readMockFile(id: string): MockFile | null {
  return load().files[id] ?? null;
}

const BLOB_DIR = path.join(STORE_DIR, "blobs");

/**
 * Store real bytes for an uploaded file. Used by the mock upload endpoint so
 * that uploading a PDF locally produces something you can actually open.
 */
export function writeMockUpload(input: {
  fileId?: string;
  name: string;
  mimeType: string;
  parentFolderId?: string | null;
  appProperties?: Record<string, string>;
  description?: string | null;
  bytes: Buffer;
  /** Lets simulated pre-existing files look owned by other people. */
  ownerEmail?: string;
}): DriveFileInfo {
  const state = load();
  const now = new Date().toISOString();
  const id = input.fileId ?? newId("upl");

  fs.mkdirSync(BLOB_DIR, { recursive: true });
  const blobFile = `${id}.bin`;
  fs.writeFileSync(path.join(BLOB_DIR, blobFile), input.bytes);

  const existing = state.files[id];
  state.files[id] = {
    id,
    name: input.name,
    mimeType: input.mimeType,
    description: input.description ?? existing?.description ?? null,
    parents: input.parentFolderId
      ? [input.parentFolderId]
      : (existing?.parents ?? []),
    appProperties: { ...(existing?.appProperties ?? {}), ...(input.appProperties ?? {}) },
    createdTime: existing?.createdTime ?? now,
    modifiedTime: now,
    trashed: false,
    permissions:
      existing?.permissions ??
      [
        {
          id: newId("perm"),
          email: input.ownerEmail ?? MOCK_ACCOUNT,
          role: "owner",
          type: "user",
        },
      ],
    sizeBytes: input.bytes.byteLength,
    blobFile,
    revisions: (existing?.revisions ?? 0) + 1,
    headerPreview: existing?.headerPreview ?? null,
  };
  save(state);
  return toInfo(state.files[id]);
}

export function readMockBlob(
  fileId: string,
): { bytes: Buffer; mimeType: string; name: string } | null {
  const file = load().files[fileId];
  if (!file?.blobFile) return null;
  try {
    return {
      bytes: fs.readFileSync(path.join(BLOB_DIR, file.blobFile)),
      mimeType: file.mimeType,
      name: file.name,
    };
  } catch {
    return null;
  }
}

export function readMockState(): MockState {
  return load();
}

export class MockDriveProvider implements DriveProvider {
  readonly mode = "mock" as const;

  async accountEmail() {
    return load().accountEmail;
  }

  async ensureFolder(name: string, parentId?: string | null): Promise<string> {
    const state = load();
    const existing = Object.values(state.files).find(
      (file) =>
        !file.trashed &&
        file.mimeType === "application/vnd.google-apps.folder" &&
        file.name === name &&
        (parentId ? file.parents.includes(parentId) : file.parents.length === 0),
    );
    if (existing) return existing.id;

    const id = newId("fld");
    const now = new Date().toISOString();
    state.files[id] = {
      id,
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [],
      createdTime: now,
      modifiedTime: now,
      trashed: false,
      permissions: [{ id: newId("perm"), email: MOCK_ACCOUNT, role: "owner", type: "user" }],
    };
    save(state);
    return id;
  }

  async createDocument(input: CreateDocumentInput): Promise<DriveFileInfo> {
    const state = load();
    const id = newId("doc");
    const now = new Date().toISOString();
    const header = input.header;

    state.files[id] = {
      id,
      name: input.name,
      mimeType: DOC_TYPE_META[input.docType].mimeType ?? "application/octet-stream",
      description: input.description ?? null,
      parents: input.parentFolderId ? [input.parentFolderId] : [],
      appProperties: input.appProperties,
      createdTime: now,
      modifiedTime: now,
      trashed: false,
      permissions: [{ id: newId("perm"), email: MOCK_ACCOUNT, role: "owner", type: "user" }],
      fromTemplate: input.templateFileId ?? null,
      headerPreview: header
        ? [
            header.title,
            [
              header.production ? `Production: ${header.production}` : `${header.orgName} · org-wide`,
              `Category: ${header.category}`,
              `Filed by: ${header.owner}`,
            ].join("  ·  "),
            `As filed on the ${header.orgName} hub — current details and sharing: ${header.hubUrl}`,
          ].join("\n")
        : null,
    };
    save(state);
    const info = toInfo(state.files[id]);
    // Forms have a separate link for answering; simulate one so the flow that
    // stores and displays it can be exercised without the Forms API.
    if (input.docType === "FORM") info.formResponderUrl = `/mock-drive/${id}?respond=1`;
    return info;
  }

  async getFile(fileId: string): Promise<DriveFileInfo | null> {
    const state = load();
    const existing = state.files[fileId];
    if (existing) return toInfo(existing);

    // Ids the hub did not mint are treated as pre-existing Drive files that
    // somebody shared with the hub account, so "add existing" and templates
    // can be exercised without a real Google connection.
    if (/^(fld|doc|perm|upl)_/.test(fileId)) return null;

    const now = new Date().toISOString();
    state.files[fileId] = {
      id: fileId,
      name: "Existing Drive file (simulated)",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [],
      createdTime: now,
      modifiedTime: now,
      trashed: false,
      permissions: [
        { id: newId("perm"), email: "someone@pennplayers.example", role: "owner", type: "user" },
      ],
    };
    save(state);
    return toInfo(state.files[fileId]);
  }

  async listFolder(folderId: string): Promise<DriveFileInfo[]> {
    return Object.values(load().files)
      .filter((file) => !file.trashed && file.parents.includes(folderId))
      .map(toInfo);
  }

  async listSharedFolders(limit = 25): Promise<DriveFileInfo[]> {
    // The simulation has no notion of another account's Drive, so every folder
    // counts as visible. Enough to exercise the diagnostic's shape.
    return Object.values(load().files)
      .filter((file) => !file.trashed && file.mimeType === "application/vnd.google-apps.folder")
      .slice(0, limit)
      .map(toInfo);
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    const state = load();
    const file = state.files[fileId];
    if (!file) return;
    file.name = name;
    file.modifiedTime = new Date().toISOString();
    save(state);
  }

  async setAppProperties(fileId: string, properties: Record<string, string>): Promise<void> {
    const state = load();
    const file = state.files[fileId];
    if (!file) return;
    file.appProperties = { ...(file.appProperties ?? {}), ...properties };
    save(state);
  }

  async moveFile(fileId: string, parentFolderId: string): Promise<void> {
    const state = load();
    const file = state.files[fileId];
    if (!file) return;
    file.parents = [parentFolderId];
    save(state);
  }

  async updateDescription(fileId: string, description: string): Promise<void> {
    const state = load();
    const file = state.files[fileId];
    if (!file) return;
    file.description = description;
    save(state);
  }

  async trashFile(fileId: string): Promise<void> {
    const state = load();
    const file = state.files[fileId];
    if (!file) return;
    file.trashed = true;
    save(state);
  }

  async applySharing(fileId: string, plan: SharingPlan): Promise<SharingResult> {
    const state = load();
    const file = state.files[fileId];
    if (!file) {
      return { granted: [], revoked: [], warnings: ["Mock file no longer exists."] };
    }

    const desired = new Map<string, "reader" | "writer">();
    desired.set(plan.creatorEmail.toLowerCase(), "writer");
    for (const extra of plan.extra ?? []) {
      const email = extra.email.toLowerCase();
      if (desired.get(email) === "writer") continue;
      desired.set(email, extra.level === "WRITER" ? "writer" : "reader");
    }

    const additive = plan.strategy === "additive";
    const retiredGroup = plan.retireGroupEmail?.toLowerCase() ?? null;
    const revoked: string[] = [];
    const kept: MockPermission[] = [];

    for (const perm of file.permissions) {
      if (perm.role === "owner") {
        kept.push(perm);
        continue;
      }
      const email = perm.email.toLowerCase();
      const wanted = desired.get(email);
      if (wanted) {
        kept.push({ ...perm, role: wanted });
        desired.delete(email);
        continue;
      }
      // Nobody wants this permission any more. On a file the hub does not own
      // that means leaving it alone, except for the old board group.
      if (additive && email !== retiredGroup) {
        kept.push(perm);
        continue;
      }
      revoked.push(perm.email);
    }

    const granted: AppliedPermission[] = kept
      .filter((perm) => perm.role !== "owner")
      .map((perm) => ({
        email: perm.email,
        level: perm.role === "writer" ? "WRITER" : "READER",
        permissionId: perm.id,
      }));

    for (const [email, role] of desired) {
      const id = newId("perm");
      kept.push({ id, email, role, type: "user" });
      granted.push({ email, level: role === "writer" ? "WRITER" : "READER", permissionId: id });
    }

    file.permissions = kept;
    file.modifiedTime = new Date().toISOString();
    save(state);
    return { granted, revoked, warnings: [] };
  }
}
