/**
 * Browser side of the upload flow. Deliberately dependency-free and
 * server-import-free so it can be pulled into any client component.
 *
 * Three hops: ask the server to authorise the upload, push the bytes wherever
 * it points us (normally straight to Google), then tell the server it landed.
 */

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

class NetworkFailure extends Error {}

function putFile(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // Hold the last 2% back for the finish call, so the bar doesn't sit
        // at 100% while the server is still working.
        onProgress(Math.min(98, Math.round((event.loaded / event.total) * 98)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        } catch {
          resolve({});
        }
        return;
      }
      let message = `The upload failed (${xhr.status}).`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        /* keep the generic message */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new NetworkFailure("The connection dropped during the upload."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

export async function uploadFile(options: {
  file: File;
  start: UploadStartBody;
  onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const { file, start, onProgress } = options;

  const plan = await postJson<{
    uploadId: string;
    kind: "resumable" | "direct";
    uploadUrl: string;
    proxyUrl?: string;
  }>("/api/uploads/start", {
    ...start,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });

  onProgress?.(1);

  let response: Record<string, unknown>;
  try {
    response = await putFile(plan.uploadUrl, file, onProgress);
  } catch (error) {
    // A dropped connection to Google is usually a proxy or an extension
    // interfering; try again through our own server before giving up.
    if (error instanceof NetworkFailure && plan.proxyUrl) {
      response = await putFile(plan.proxyUrl, file, onProgress);
    } else {
      throw error;
    }
  }

  const fileId =
    typeof response.fileId === "string"
      ? response.fileId
      : typeof response.id === "string"
        ? response.id
        : undefined;

  const finished = await postJson<UploadResult>("/api/uploads/finish", {
    uploadId: plan.uploadId,
    fileId,
  });
  onProgress?.(100);
  return { ...finished, warnings: finished.warnings ?? [] };
}
