import { env } from "../env";
import { driveClient } from "./oauth";
import { GoogleCallError } from "./types";

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
 * There is a server-side proxy fallback for the case where the browser's direct
 * PUT is blocked (corporate proxies, odd extensions); it is subject to the host
 * body limit, which is fine for the small files that path tends to see.
 */

const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

export type UploadPlan =
  | { kind: "resumable"; uploadUrl: string }
  | { kind: "direct"; uploadUrl: string };

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
