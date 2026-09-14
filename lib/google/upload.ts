import { env } from "../env";
import { driveClient } from "./oauth";
import { GoogleCallError, type DriveFileInfo } from "./types";

/**
 * Uploads go straight from the member's browser to Google, using a resumable
 * session that the server opens on their behalf.
 *
 * Two reasons it works this way rather than posting the file to us:
 *
 *  - a vocal score or a video of a run-through is tens of megabytes, and
 *    serverless hosts cap request bodies at a few (Vercel: 4.5 MB), so routing
 *    the bytes through the app would break exactly the files people care about;
 *  - the file name, folder and appProperties are fixed when the *server* opens
 *    the session, so the browser cannot redirect the upload somewhere else or
 *    rename it around the hub's rules.
 *
 * The browser sends bounded chunks and asks the server for the acknowledged
 * offset after an interruption. Recording bytes never pass through the app.
 */

const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

export type UploadPlan =
  | { kind: "resumable"; uploadUrl: string }
  | { kind: "direct"; uploadUrl: string };

export class UploadSessionError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryable = false) {
    super(message);
  }
}

/** Query Google's acknowledged byte count without sending any file content. */
export async function resumableUploadStatus(sessionUrl: string, sizeBytes: number): Promise<{
  complete: boolean;
  offset: number;
  fileId?: string;
}> {
  let response: Response;
  try {
    response = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Length": "0", "Content-Range": `bytes */${sizeBytes}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new UploadSessionError("Could not reach Google to check upload progress. Retrying is safe.", 502, true);
  }
  if (response.status === 308) {
    const range = response.headers.get("range");
    if (!range) return { complete: false, offset: 0 };
    const match = /^bytes=0-(\d+)$/i.exec(range);
    const offset = match ? Number(match[1]) + 1 : NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > sizeBytes) {
      throw new UploadSessionError("Google returned an invalid upload position. Please retry.", 502, true);
    }
    return { complete: false, offset };
  }
  if (response.status === 200 || response.status === 201) {
    const file = await response.json().catch(() => ({})) as { id?: string };
    if (!file.id) throw new UploadSessionError("Google has not returned the finished file yet. Please retry.", 502, true);
    return { complete: true, offset: sizeBytes, fileId: file.id };
  }
  if (response.status === 404 || response.status === 410) {
    throw new UploadSessionError("This upload session expired. Select the file again to start a new upload.", 410);
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new UploadSessionError("Google is temporarily unavailable. Your uploaded progress is retained; please retry.", 503, true);
  }
  if (response.status === 403) {
    const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
    const reasons = body?.error?.errors?.map(error => error.reason) ?? [];
    if (reasons.some(reason => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded")) {
      throw new UploadSessionError("Google is temporarily limiting uploads. Your uploaded progress is retained; please retry.", 503, true);
    }
    if (reasons.includes("storageQuotaExceeded")) {
      throw new UploadSessionError("The connected Google Drive is out of storage. Free up space or ask an administrator to increase storage, then start the upload again.", 403);
    }
  }
  // An unusable capability must be removed from the browser's saved session,
  // so that the next attempt can start a fresh upload rather than loop forever.
  throw new UploadSessionError("Google could not continue this upload. Select the file again to start a new upload.", 410);
}

async function accessToken(): Promise<string> {
  const client = await driveClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new GoogleCallError(
      "Could not get a Google access token for the hub account.",
      "Reconnect the hub's Google account in Admin → Google connection.",
    );
  }
  return token.token;
}

/** Opens a resumable session for a brand-new file. */
export async function openResumableCreate(input: {
  name: string;
  mimeType: string;
  parentFolderId: string | null;
  description?: string | null;
  appProperties?: Record<string, string>;
  sizeBytes?: number | null;
}): Promise<string> {
  const token = await accessToken();
  const response = await fetch(`${UPLOAD_BASE}?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      ...(input.sizeBytes ? { "X-Upload-Content-Length": String(input.sizeBytes) } : {}),
    },
    body: JSON.stringify({
      name: input.name,
      mimeType: input.mimeType,
      parents: input.parentFolderId ? [input.parentFolderId] : undefined,
      description: input.description ?? undefined,
      appProperties: input.appProperties,
    }),
  });

  const location = response.headers.get("location");
  if (!response.ok || !location) {
    throw new GoogleCallError(
      `Google would not start the upload (${response.status}): ${await response.text()}`,
      response.status === 401
        ? "Reconnect the hub's Google account in Admin → Google connection."
        : undefined,
    );
  }
  return location;
}

/** Opens a resumable session that replaces the contents of an existing file. */
export async function openResumableUpdate(input: {
  fileId: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  sizeBytes?: number | null;
  name?: string;
}): Promise<string> {
  const token = await accessToken();
  const response = await fetch(
    `${UPLOAD_BASE}/${encodeURIComponent(input.fileId)}?uploadType=resumable&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        ...(input.sizeBytes ? { "X-Upload-Content-Length": String(input.sizeBytes) } : {}),
      },
      body: JSON.stringify({
        name: input.name,
        appProperties: input.appProperties,
      }),
    },
  );

  const location = response.headers.get("location");
  if (!response.ok || !location) {
    throw new GoogleCallError(
      `Google would not start the replacement upload (${response.status}): ${await response.text()}`,
    );
  }
  return location;
}

/**
 * Server-side fallback: push the bytes to an already-open session. Returns the
 * Drive file id.
 */
export async function pushToSession(
  sessionUrl: string,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new GoogleCallError(
      `The upload to Google failed (${response.status}): ${await response.text()}`,
    );
  }
  const file = (await response.json()) as { id?: string };
  if (!file.id) throw new GoogleCallError("Google finished the upload without returning a file id.");
  return file.id;
}

export function uploadsGoDirectToGoogle() {
  return env.driveMode === "google";
}

/**
 * Put bytes the server already holds into Drive — used by the Canva mirror,
 * where the file comes from Canva rather than from somebody's browser.
 * Pass `fileId` to replace the contents of an existing file, which keeps its
 * link, its sharing and its Drive revision history.
 */
export async function putBytesToDrive(input: {
  fileId?: string | null;
  name: string;
  mimeType: string;
  parentFolderId: string | null;
  description?: string | null;
  appProperties?: Record<string, string>;
  bytes: Buffer;
}): Promise<DriveFileInfo> {
  const { driveProvider } = await import("./index");

  if (env.driveMode === "mock") {
    const { writeMockUpload } = await import("./mock");
    return writeMockUpload({
      fileId: input.fileId ?? undefined,
      name: input.name,
      mimeType: input.mimeType,
      parentFolderId: input.parentFolderId,
      description: input.description,
      appProperties: input.appProperties,
      bytes: input.bytes,
    });
  }

  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;

  const sessionUrl = input.fileId
    ? await openResumableUpdate({
        fileId: input.fileId,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        name: input.name,
      })
    : await openResumableCreate({
        name: input.name,
        mimeType: input.mimeType,
        parentFolderId: input.parentFolderId,
        description: input.description,
        appProperties: input.appProperties,
        sizeBytes: input.bytes.byteLength,
      });

  const fileId = await pushToSession(sessionUrl, body, input.mimeType);
  const file = await driveProvider().getFile(fileId);
  if (!file) {
    throw new GoogleCallError("Drive accepted the upload but will not return the file.");
  }
  return file;
}
