import { UPLOAD_SERVER_MAX_BYTES } from "./constants";

export class UploadBodyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** Bound memory even when Content-Length is missing or dishonest. */
export async function readSmallUploadBody(request: Request, expectedSize: bigint | null): Promise<ArrayBuffer> {
  const length = Number(request.headers.get("content-length"));
  if ((expectedSize !== null && expectedSize > BigInt(UPLOAD_SERVER_MAX_BYTES)) || length > UPLOAD_SERVER_MAX_BYTES) {
    throw new UploadBodyError("Files larger than 4 MB must upload directly to Google Drive. Please retry the upload.", 413);
  }
  if (!request.body) throw new UploadBodyError("That file is empty.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > UPLOAD_SERVER_MAX_BYTES) {
        await reader.cancel();
        throw new UploadBodyError("Files larger than 4 MB must upload directly to Google Drive. Please retry the upload.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new UploadBodyError("That file is empty.", 400);
  if (expectedSize !== null && BigInt(size) !== expectedSize) {
    throw new UploadBodyError("The uploaded file size does not match the selected file. Please retry.", 400);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
