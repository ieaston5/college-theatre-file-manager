/** Google resumable upload protocol, independent of the browser transport. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export class UploadFailure extends Error {
  constructor(message: string, public retryable = false, public status = 0) {
    super(message);
  }
}

export type UploadStatus = {
  complete: boolean;
  offset: number;
  fileId?: string;
  uploadUrl?: string;
};

export type ChunkResponse = {
  status: number;
  range: string | null;
  body: Record<string, unknown>;
};

export function responseFailure(response: ChunkResponse): UploadFailure {
  const error = response.body.error as { message?: string; errors?: Array<{ reason?: string }> } | string | undefined;
  const message = typeof error === "string" ? error : error?.message;
  const rateLimited = typeof error === "object" && error?.errors?.some(({ reason }) =>
    reason === "rateLimitExceeded" || reason === "userRateLimitExceeded");
  const expired = response.status === 404 || response.status === 410;
  return new UploadFailure(
    expired ? "This upload session expired. Retry to start a new upload." :
      message ?? `The upload failed (${response.status}).`,
    response.status === 408 || response.status === 429 || response.status >= 500 || Boolean(rateLimited),
    response.status,
  );
}

/** Only Google's acknowledged byte range determines where the next chunk starts. */
export function acknowledgedOffset(range: string, total: number): number {
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > total) {
    throw new UploadFailure("Drive returned an invalid upload position. Retry the upload.");
  }
  return offset;
}

export async function uploadChunks(options: {
  file: Pick<File, "size" | "slice" | "type">;
  uploadUrl: string;
  initial?: UploadStatus;
  send: (url: string, body: Blob, range: string, progress: (loaded: number) => void) => Promise<ChunkResponse>;
  status: () => Promise<UploadStatus>;
  onProgress?: (pct: number) => void;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<string> {
  const { file, send, onProgress } = options;
  const sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  let url = options.uploadUrl;
  let offset = options.initial?.offset ?? 0;
  let checkStatus = false;
  let retries = 0;
  let shown = 0;
  const progress = (bytes: number) => {
    shown = Math.max(shown, Math.min(98, Math.floor(bytes / file.size * 98)));
    onProgress?.(shown);
  };
  const acceptStatus = (state: UploadStatus) => {
    if (state.complete) {
      if (!state.fileId) throw new UploadFailure("Drive finished without a file identifier. Retry to recover the upload.", true);
      return state.fileId;
    }
    if (!Number.isSafeInteger(state.offset) || state.offset < offset || state.offset > file.size) {
      throw new UploadFailure("Drive returned an invalid upload position. Retry the upload.");
    }
    if (state.offset > offset) retries = 0;
    offset = state.offset;
    if (state.uploadUrl) url = state.uploadUrl;
    progress(offset);
  };
  if (options.initial) {
    const finished = acceptStatus(options.initial);
    if (finished) return finished;
  }
  while (true) {
    try {
      if (checkStatus) {
        const finished = acceptStatus(await options.status());
        if (finished) return finished;
        checkStatus = false;
      }
      if (offset >= file.size) {
        throw new UploadFailure("Drive has not confirmed the completed upload yet.", true);
      }
      const start = offset;
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size);
      const response = await send(url, file.slice(start, end), `bytes ${start}-${end - 1}/${file.size}`,
        loaded => progress(start + loaded));
      if (response.status === 200 || response.status === 201) {
        if (typeof response.body.id === "string") return response.body.id;
        const finished = acceptStatus(await options.status());
        if (finished) return finished;
      } else if (response.status === 308) {
        // Range is not always exposed by Google's CORS headers. The authenticated
        // metadata-only status endpoint reads it server-side when necessary.
        if (response.range) {
          const next = acknowledgedOffset(response.range, file.size);
          if (next < offset || next > end) throw new UploadFailure("Drive returned an unexpected upload position.");
          offset = next;
        } else {
          const finished = acceptStatus(await options.status());
          if (finished) return finished;
        }
      } else if (response.status === 400 || response.status === 409) {
        // Browsers may replay an idempotent PUT themselves after a connection
        // reset. If Google already accepted part of that range, recover only
        // when its status confirms forward progress; do not retry bad requests
        // indefinitely or infer that all bytes arrived.
        const finished = acceptStatus(await options.status());
        if (finished) return finished;
        if (offset <= start) throw responseFailure(response);
      } else {
        throw responseFailure(response);
      }
      if (offset <= start) throw new UploadFailure("Drive has not received the next part yet.", true);
      retries = 0;
      progress(offset);
    } catch (error) {
      if (!(error instanceof UploadFailure) || !error.retryable) throw error;
      if (retries >= (options.maxRetries ?? 7)) {
        throw new UploadFailure("The connection is still unavailable. Keep this file selected and retry to resume your upload.", true);
      }
      await sleep(Math.min(30_000, 1_000 * 2 ** retries++));
      // An interrupted request may already have reached Google, including the
      // final chunk. Query first; never blindly resend or create another file.
      checkStatus = true;
    }
  }
}
