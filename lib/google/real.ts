import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { DOC_TYPE_META } from "../constants";
import { formatDate } from "../utils";
import { driveClient } from "./oauth";
import {
  GoogleCallError,
  type AppliedPermission,
  type CreateDocumentInput,
  type DocHeader,
  type DriveFileInfo,
  type DriveProvider,
  type SharingPlan,
  type SharingResult,
} from "./types";

const FILE_FIELDS =
  "id,name,mimeType,webViewLink,iconLink,modifiedTime,parents,trashed,size,appProperties,owners(emailAddress)";

function toInfo(file: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  webViewLink?: string | null;
  iconLink?: string | null;
  modifiedTime?: string | null;
  parents?: string[] | null;
  trashed?: boolean | null;
  size?: string | null;
  appProperties?: Record<string, string> | null;
  owners?: Array<{ emailAddress?: string | null }> | null;
}): DriveFileInfo {
  return {
    id: file.id ?? "",
    name: file.name ?? "Untitled",
    mimeType: file.mimeType ?? "application/octet-stream",
    webViewLink: file.webViewLink ?? "",
    iconLink: file.iconLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    parents: file.parents ?? [],
    trashed: file.trashed ?? false,
    ownerEmail: file.owners?.[0]?.emailAddress ?? null,
    sizeBytes: file.size ? Number(file.size) : null,
    appProperties: file.appProperties ?? null,
  };
}

/** Drive query strings are single-quoted; escape any quotes in the value. */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function wrap(error: unknown, what: string): never {
  const anyError = error as { code?: number; message?: string; errors?: Array<{ reason?: string }> };
  const reason = anyError?.errors?.[0]?.reason;
  const status = anyError?.code;
  let hint: string | undefined;

  if (status === 401 || reason === "authError") {
    hint = "The hub's Google account needs to be reconnected in Admin → Google connection.";
  } else if (status === 403 && reason === "insufficientFilePermissions") {
    hint = "The hub's Google account does not have edit access to that file.";
  } else if (status === 403 && reason === "cannotShare") {
    hint = "Google refused the share — check that the group address accepts external members.";
  } else if (status === 404) {
    hint = "Either the file does not exist, or it has not been shared with the hub's Google account.";
  } else if (status === 429 || reason === "rateLimitExceeded") {
    hint = "Google is rate-limiting the hub. Wait a minute and try again.";
  }

  throw new GoogleCallError(
    `${what} failed: ${anyError?.message ?? String(error)}`,
    hint,
  );
}

export class GoogleDriveProvider implements DriveProvider {
  readonly mode = "google" as const;
  private authPromise: Promise<OAuth2Client> | null = null;

  private auth(): Promise<OAuth2Client> {
    this.authPromise ??= driveClient();
    return this.authPromise;
  }

  private async drive() {
    return google.drive({ version: "v3", auth: await this.auth() });
  }

  async accountEmail(): Promise<string | null> {
    try {
      const auth = await this.auth();
      const info = await google.oauth2({ version: "v2", auth }).userinfo.get();
      return info.data.email?.toLowerCase() ?? null;
    } catch {
      return null;
    }
  }

  async ensureFolder(name: string, parentId?: string | null): Promise<string> {
    const drive = await this.drive();
    try {
      const parentClause = parentId ? ` and '${esc(parentId)}' in parents` : "";
      const found = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and name = '${esc(name)}' and trashed = false${parentClause}`,
        fields: "files(id,name)",
        pageSize: 5,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const existing = found.data.files?.[0]?.id;
      if (existing) return existing;

      const created = await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
        },
        fields: "id",
        supportsAllDrives: true,
      });
      if (!created.data.id) throw new Error("Drive returned no folder id");
      return created.data.id;
    } catch (error) {
      wrap(error, `Creating the folder "${name}"`);
    }
  }

  async createDocument(input: CreateDocumentInput): Promise<DriveFileInfo> {
    const drive = await this.drive();
    const meta = DOC_TYPE_META[input.docType];
    const parents = input.parentFolderId ? [input.parentFolderId] : undefined;

    let file: DriveFileInfo;
    try {
      if (input.templateFileId) {
        const copy = await drive.files.copy({
          fileId: input.templateFileId,
          requestBody: {
            name: input.name,
            parents,
            description: input.description ?? undefined,
            appProperties: input.appProperties,
          },
          fields: FILE_FIELDS,
          supportsAllDrives: true,
        });
        file = toInfo(copy.data);
      } else {
        const created = await drive.files.create({
          requestBody: {
            name: input.name,
            mimeType: meta.mimeType ?? undefined,
            parents,
            description: input.description ?? undefined,
            appProperties: input.appProperties,
          },
          fields: FILE_FIELDS,
          supportsAllDrives: true,
        });
        file = toInfo(created.data);
      }
    } catch (error) {
      wrap(error, "Creating the document in Google Drive");
    }

    // Content pass: fill template placeholders, or stamp a header on a blank doc.
    if (input.header) {
      try {
        if (input.templateFileId) {
          await this.fillPlaceholders(file.id, input.docType, input.header);
        } else if (input.docType === "DOC") {
          await this.stampDocHeader(file.id, input.header);
        }
      } catch (error) {
        // A cosmetic failure should not lose the document.
        console.error("[google] could not write document header", error);
      }
    }

    return file;
  }

  private placeholderValues(header: DocHeader): Record<string, string> {
    return {
      "{{TITLE}}": header.title,
      "{{PRODUCTION}}": header.production ?? "—",
      "{{CATEGORY}}": header.category,
      "{{SEASON}}": "",
      "{{OWNER}}": header.owner,
      "{{DATE}}": formatDate(header.createdAt),
      "{{ORG}}": header.orgName,
    };
  }

  private async fillPlaceholders(fileId: string, docType: string, header: DocHeader) {
    const auth = await this.auth();
    const values = this.placeholderValues(header);

    if (docType === "DOC") {
      const requests = Object.entries(values).map(([token, value]) => ({
        replaceAllText: { containsText: { text: token, matchCase: true }, replaceText: value },
      }));
      await google
        .docs({ version: "v1", auth })
        .documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
      return;
    }

    if (docType === "SLIDES") {
      const requests = Object.entries(values).map(([token, value]) => ({
        replaceAllText: { containsText: { text: token, matchCase: true }, replaceText: value },
      }));
      await google
        .slides({ version: "v1", auth })
        .presentations.batchUpdate({ presentationId: fileId, requestBody: { requests } });
      return;
    }

    if (docType === "SHEET") {
      const requests = Object.entries(values).map(([token, value]) => ({
        findReplace: { find: token, replacement: value, allSheets: true, matchCase: true },
      }));
      await google
        .sheets({ version: "v4", auth })
        .spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests } });
    }
  }

  /** Prepend a small identity block to a blank Google Doc. */
  private async stampDocHeader(documentId: string, header: DocHeader) {
    const auth = await this.auth();
    const docs = google.docs({ version: "v1", auth });

    // A snapshot of how the document was filed. The hub stays the source of
    // truth, so the block points back at it rather than pretending to be live.
    const metaBits = [
      header.production ? `Production: ${header.production}` : `${header.orgName} · org-wide`,
      `Category: ${header.category}`,
      `Filed by: ${header.owner}`,
      formatDate(header.createdAt),
    ];
    const metaLine = `${metaBits.join("  ·  ")}\nAs filed on the ${header.orgName} hub — current details and sharing: ${header.hubUrl}`;
    const titleLine = `${header.title}\n`;
    const body = `${titleLine}${metaLine}\n\n`;

    const titleStart = 1;
    const titleEnd = titleStart + titleLine.length; // includes the newline
    const metaStart = titleEnd;
    const metaEnd = metaStart + metaLine.length;

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: 1 }, text: body } },
          {
            updateParagraphStyle: {
              range: { startIndex: titleStart, endIndex: titleEnd },
              paragraphStyle: { namedStyleType: "TITLE" },
              fields: "namedStyleType",
            },
          },
          {
            updateTextStyle: {
              range: { startIndex: metaStart, endIndex: metaEnd },
              textStyle: {
                italic: true,
                fontSize: { magnitude: 9, unit: "PT" },
                foregroundColor: {
                  color: { rgbColor: { red: 0.42, green: 0.45, blue: 0.5 } },
                },
              },
              fields: "italic,fontSize,foregroundColor",
            },
          },
        ],
      },
    });
  }

  async getFile(fileId: string): Promise<DriveFileInfo | null> {
    const drive = await this.drive();
    try {
      const res = await drive.files.get({
        fileId,
        fields: FILE_FIELDS,
        supportsAllDrives: true,
      });
      return toInfo(res.data);
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      wrap(error, "Reading the file from Google Drive");
    }
  }

  async listFolder(folderId: string): Promise<DriveFileInfo[]> {
    const drive = await this.drive();
    const out: DriveFileInfo[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const res = await drive.files.list({
          q: `'${esc(folderId)}' in parents and trashed = false`,
          fields: `nextPageToken, files(${FILE_FIELDS})`,
          pageSize: 200,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        out.push(...(res.data.files ?? []).map(toInfo));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    } catch (error) {
      wrap(error, "Listing the Drive folder");
    }
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    const drive = await this.drive();
    try {
      await drive.files.update({ fileId, requestBody: { name }, supportsAllDrives: true });
    } catch (error) {
      wrap(error, "Renaming the file");
    }
  }

  async moveFile(fileId: string, parentFolderId: string): Promise<void> {
    const drive = await this.drive();
    try {
      const current = await drive.files.get({
        fileId,
        fields: "parents",
        supportsAllDrives: true,
      });
      const previous = (current.data.parents ?? []).join(",");
      if (previous === parentFolderId) return;
      await drive.files.update({
        fileId,
        addParents: parentFolderId,
        removeParents: previous || undefined,
        supportsAllDrives: true,
      });
    } catch (error) {
      wrap(error, "Moving the file");
    }
  }

  async updateDescription(fileId: string, description: string): Promise<void> {
    const drive = await this.drive();
    try {
      await drive.files.update({ fileId, requestBody: { description }, supportsAllDrives: true });
    } catch (error) {
      wrap(error, "Updating the file description");
    }
  }

  async trashFile(fileId: string): Promise<void> {
    const drive = await this.drive();
    try {
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
    } catch (error) {
      wrap(error, "Moving the file to the Drive trash");
    }
  }

  /**
   * Reconcile the file's permissions so they exactly match the plan. Anything
   * not in the plan is revoked — that is what makes flipping a document from
   * Board back to Private actually un-share it from the group, and what keeps
   * "anyone with the link" from ever surviving on a hub document.
   */
  async applySharing(fileId: string, plan: SharingPlan): Promise<SharingResult> {
    const drive = await this.drive();
    const granted: AppliedPermission[] = [];
    const revoked: string[] = [];
    const warnings: string[] = [];

    const desired = new Map<string, { level: "READER" | "WRITER"; type: "user" | "group" }>();
    desired.set(plan.creatorEmail.toLowerCase(), { level: "WRITER", type: "user" });
    if (plan.visibility !== "PRIVATE" && plan.groupEmail) {
      desired.set(plan.groupEmail.toLowerCase(), {
        level: plan.groupCanEdit ? "WRITER" : "READER",
        type: "group",
      });
    }
    for (const extra of plan.extra ?? []) {
      const email = extra.email.toLowerCase();
      if (desired.get(email)?.level === "WRITER") continue;
      desired.set(email, { level: extra.level, type: "user" });
    }

    let existing: Array<{
      id?: string | null;
      type?: string | null;
      role?: string | null;
      emailAddress?: string | null;
    }> = [];
    try {
      const res = await drive.permissions.list({
        fileId,
        fields: "permissions(id,type,role,emailAddress,deleted)",
        pageSize: 100,
        supportsAllDrives: true,
      });
      existing = res.data.permissions ?? [];
    } catch (error) {
      wrap(error, "Reading the file's sharing settings");
    }

    const additive = plan.strategy === "additive";
    const groupEmail = plan.groupEmail?.toLowerCase() ?? null;

    // 1. Reconcile what is already on the file.
    for (const perm of existing) {
      if (!perm.id || perm.role === "owner") continue;
      const email = perm.emailAddress?.toLowerCase();
      const isLinkShare = perm.type === "anyone" || perm.type === "domain";
      const wanted = email ? desired.get(email) : undefined;
      const roleMatches =
        wanted && perm.role === (wanted.level === "WRITER" ? "writer" : "reader");

      if (wanted && roleMatches) {
        // Already exactly right: keep it and don't re-grant below.
        desired.delete(email!);
        granted.push({ email: email!, level: wanted.level, permissionId: perm.id });
        continue;
      }

      if (wanted && !roleMatches) {
        // Right person, wrong role — change it in place.
        try {
          await drive.permissions.update({
            fileId,
            permissionId: perm.id,
            requestBody: { role: wanted.level === "WRITER" ? "writer" : "reader" },
            supportsAllDrives: true,
          });
          desired.delete(email!);
          granted.push({ email: email!, level: wanted.level, permissionId: perm.id });
        } catch (error) {
          warnings.push(`Could not change ${email}'s access: ${(error as Error).message}`);
        }
        continue;
      }

      // On a file the hub does not own, only ever pull the board group back.
      const shouldRevoke = additive
        ? Boolean(email && groupEmail && email === groupEmail && !wanted)
        : isLinkShare || !wanted || !roleMatches;
      if (!shouldRevoke) continue;

      try {
        await drive.permissions.delete({
          fileId,
          permissionId: perm.id,
          supportsAllDrives: true,
        });
        revoked.push(email ?? perm.type ?? "unknown");
      } catch (error) {
        warnings.push(
          `Could not revoke access for ${email ?? perm.type}: ${(error as Error).message}`,
        );
      }
    }

    // 2. Grant what is missing. A company document can mean twenty-odd
    //    individual grants, so these go out a few at a time rather than one
    //    after another — sequential calls would make creating a document for a
    //    full cast feel broken.
    const pending = [...desired.entries()];
    const CONCURRENCY = 5;
    for (let start = 0; start < pending.length; start += CONCURRENCY) {
      await Promise.all(
        pending.slice(start, start + CONCURRENCY).map(async ([email, spec]) => {
          try {
            const res = await drive.permissions.create({
              fileId,
              requestBody: {
                type: spec.type,
                role: spec.level === "WRITER" ? "writer" : "reader",
                emailAddress: email,
              },
              sendNotificationEmail: false,
              supportsAllDrives: true,
              fields: "id",
            });
            granted.push({ email, level: spec.level, permissionId: res.data.id ?? null });
          } catch (error) {
            warnings.push(`Could not share with ${email}: ${(error as Error).message}`);
          }
        }),
      );
    }

    return { granted, revoked, warnings };
  }
}
