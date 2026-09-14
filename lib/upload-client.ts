/** Browser upload coordination. File bytes travel directly to Google in chunks. */
import { UploadFailure, responseFailure, uploadChunks, type ChunkResponse, type UploadStatus } from "./resumable-upload";

export type UploadStartBody = {
  mode?: "new" | "version";
  documentId?: string;
  title?: string;
  description?: string;
  categoryId?: string;
  productionId?: string;
  visibility?: string;
  editAccess?: string;
  tags?: string;
};

export type UploadResult = {
  documentId: string;
  title: string;
  webViewLink: string | null;
  warnings: string[];
};

type Plan = { uploadId: string; kind: "resumable" | "direct"; uploadUrl: string };
type SavedUpload = Pick<Plan, "uploadId" | "kind"> & { createdAt: number; fileId?: string };
const CACHE_PREFIX = "hub-upload-v2:";
const CACHE_AGE = 24 * 60 * 60 * 1000;
const activeUploads = new Map<string, Promise<UploadResult>>();

function readSaved(key: string): SavedUpload | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as SavedUpload | null;
    if (saved && saved.kind === "resumable" && typeof saved.uploadId === "string" &&
        Date.now() - saved.createdAt < CACHE_AGE) return saved;
    localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in private browsing. */ }
}
function save(key: string, value: SavedUpload | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* Uploads still work, but reload recovery is unavailable. */ }
}

function putBytes(url: string, body: Blob, mimeType: string, range: string | undefined,
  onProgress: (loaded: number) => void): Promise<ChunkResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    if (range) xhr.setRequestHeader("Content-Range", range);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
    xhr.onload = () => {
      let parsed: Record<string, unknown> = {};
      try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch { /* HTTP status is enough. */ }
      resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: parsed });
    };
    xhr.onerror = () => reject(new UploadFailure("The connection dropped during the upload.", true));
    xhr.ontimeout = () => reject(new UploadFailure("The connection timed out during the upload.", true));
    xhr.onabort = () => reject(new UploadFailure("Upload stopped. Select the same file and retry to resume."));
    xhr.send(body);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new UploadFailure("Could not reach the hub. Retry when your connection returns.", true);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UploadFailure(data.error ?? `Request failed (${response.status}).`,
      Boolean(data.retryable) || response.status === 408 || response.status === 429 || response.status >= 500,
      response.status);
  }
  return data as T;
}

async function retryMetadata<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (!(error instanceof UploadFailure) || !error.retryable || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(16_000, 1_000 * 2 ** attempt)));
    }
  }
}

async function performUpload(key: string, options: {
  file: File; start: UploadStartBody; onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const { file, start, onProgress } = options;
  let saved = readSaved(key);
  let initial: UploadStatus | undefined;
  let plan: Plan;
  try {
    if (saved) {
      // Ask the server to re-authorize this session. Google capability URLs are
      // never persisted in browser storage, and another account cannot reuse it.
      if (!saved.fileId) initial = await retryMetadata(() => postJson<UploadStatus>("/api/uploads/status", { uploadId: saved!.uploadId }));
      plan = { ...saved, uploadUrl: initial?.uploadUrl ?? "" };
    } else {
      // Starting is not retried automatically: a lost start response can have
      // created a session already. Retrying a known session is safe instead.
      plan = await postJson<Plan>("/api/uploads/start", {
        ...start, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
      });
      saved = { uploadId: plan.uploadId, kind: plan.kind, createdAt: Date.now() };
      if (plan.kind === "resumable") save(key, saved);
    }
    onProgress?.(1);
    let fileId = saved.fileId;
    if (!fileId && plan.kind === "resumable") {
      fileId = await uploadChunks({
        file, uploadUrl: plan.uploadUrl, initial, onProgress,
        send: (url, bytes, range, progress) => putBytes(url, bytes, file.type, range, progress),
        status: () => postJson<UploadStatus>("/api/uploads/status", { uploadId: plan.uploadId }),
      });
      save(key, { ...saved, fileId });
    } else if (!fileId) {
      // Simulated uploads are explicitly small; there is no large-file proxy fallback.
      const response = await putBytes(plan.uploadUrl, file, file.type, undefined,
        loaded => onProgress?.(Math.min(98, Math.floor(loaded / file.size * 98))));
      if (response.status < 200 || response.status >= 300) throw responseFailure(response);
      fileId = typeof response.body.fileId === "string" ? response.body.fileId : undefined;
    }
    const finished = await retryMetadata(() => postJson<UploadResult>("/api/uploads/finish", {
      uploadId: plan.uploadId, fileId,
    }));
    save(key, null);
    onProgress?.(100);
    return { ...finished, warnings: finished.warnings ?? [] };
  } catch (error) {
    if (error instanceof UploadFailure && [401, 403, 404, 410].includes(error.status) && !error.retryable) save(key, null);
    throw error;
  }
}

export async function uploadFile(options: {
  file: File; start: UploadStartBody; onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const { file, start } = options;
  // Re-selecting the same file and filing choices after a reload recovers the
  // session for 24 hours. No file bytes are held in storage or read into memory.
  const key = CACHE_PREFIX + JSON.stringify([file.name, file.size, file.lastModified,
    Object.entries(start).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
  const existing = activeUploads.get(key);
  if (existing) return existing;
  const upload = performUpload(key, options);
  activeUploads.set(key, upload);
  try { return await upload; } finally { activeUploads.delete(key); }
}
