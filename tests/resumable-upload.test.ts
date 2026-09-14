import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadChunks, UPLOAD_CHUNK_BYTES as CHUNK, UploadFailure, acknowledgedOffset, responseFailure } from "../lib/resumable-upload";

function file(size: number) {
  return { size, type: "video/mp4", slice: (start: number = 0, end: number = size) => ({ size: end - start }) as Blob };
}
const noSleep = async () => {};
const unexpectedStatus = async (): Promise<never> => { throw new Error("Unexpected status query"); };

test("a 5 GiB recording is sent in bounded 8 MiB chunks without 32-bit truncation", async () => {
  const size = 5 * 1024 ** 3 + 31;
  let acknowledged = 0, largest = 0, count = 0;
  const result = await uploadChunks({ file: file(size), uploadUrl: "google", status: unexpectedStatus,
    send: async (_url, bytes, range) => {
      const end = Math.min(acknowledged + CHUNK, size);
      assert.equal(range, `bytes ${acknowledged}-${end - 1}/${size}`);
      assert.equal(bytes.size, end - acknowledged);
      largest = Math.max(largest, bytes.size); count++; acknowledged = end;
      return end === size ? { status: 200, range: null, body: { id: "recording" } } :
        { status: 308, range: `bytes=0-${end - 1}`, body: {} };
    } });
  assert.equal(result, "recording"); assert.equal(largest, CHUNK); assert.equal(count, 641);
});

test("partial acceptance after a dropped connection resumes from acknowledged bytes", async () => {
  const ranges: string[] = []; let queried = 0;
  const result = await uploadChunks({ file: file(CHUNK * 2), uploadUrl: "google", sleep: noSleep,
    status: async () => { queried++; return { complete: false, offset: CHUNK / 2 }; },
    send: async (_url, _body, range) => {
      ranges.push(range);
      if (ranges.length === 1) throw new UploadFailure("offline", true);
      if (ranges.length === 2) return { status: 308, range: `bytes=0-${CHUNK * 1.5 - 1}`, body: {} };
      return { status: 201, range: null, body: { id: "resumed" } };
    } });
  assert.equal(result, "resumed"); assert.equal(queried, 1);
  assert.equal(ranges[1], `bytes ${CHUNK / 2}-${CHUNK * 1.5 - 1}/${CHUNK * 2}`);
});

test("lost final response is recovered without uploading the last chunk twice", async () => {
  let sent = 0;
  const result = await uploadChunks({ file: file(100), uploadUrl: "google", sleep: noSleep,
    send: async () => { sent++; throw new UploadFailure("lost reply", true); },
    status: async () => ({ complete: true, offset: 100, fileId: "already-done" }) });
  assert.equal(result, "already-done"); assert.equal(sent, 1);
});

test("hidden CORS Range headers are recovered via the authenticated status endpoint", async () => {
  let sent = 0, queried = 0;
  await uploadChunks({ file: file(CHUNK + 3), uploadUrl: "google",
    status: async () => { queried++; return { complete: false, offset: CHUNK }; },
    send: async (_url, _body, range) => {
      if (++sent === 1) return { status: 308, range: null, body: {} };
      assert.equal(range, `bytes ${CHUNK}-${CHUNK + 2}/${CHUNK + 3}`);
      return { status: 200, range: null, body: { id: "done" } };
    } });
  assert.equal(queried, 1);
});

test("a recovered session skips bytes uploaded before a reload", async () => {
  let range = "";
  await uploadChunks({ file: file(CHUNK + 7), uploadUrl: "", initial: { complete: false, offset: CHUNK, uploadUrl: "authorized" },
    status: unexpectedStatus, send: async (url, _body, sentRange) => {
      assert.equal(url, "authorized"); range = sentRange;
      return { status: 200, range: null, body: { id: "done" } };
    } });
  assert.equal(range, `bytes ${CHUNK}-${CHUNK + 6}/${CHUNK + 7}`);
});

test("quota throttling retries after checking the session; permanent errors stop", async () => {
  let attempts = 0;
  await uploadChunks({ file: file(10), uploadUrl: "google", sleep: noSleep,
    status: async () => ({ complete: false, offset: 0 }),
    send: async () => ++attempts === 1 ? { status: 429, range: null, body: {} } : { status: 200, range: null, body: { id: "done" } } });
  assert.equal(attempts, 2);
  assert.equal(responseFailure({ status: 403, range: null, body: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } }).retryable, true);
  await assert.rejects(uploadChunks({ file: file(10), uploadUrl: "google", status: unexpectedStatus,
    send: async () => ({ status: 403, range: null, body: { error: { message: "Storage quota exceeded" } } }) }), /Storage quota/);
});

test("stalled acknowledgements and prolonged network failures have bounded retries", async () => {
  let sends = 0;
  await assert.rejects(uploadChunks({ file: file(10), uploadUrl: "google", sleep: noSleep, maxRetries: 2,
    status: async () => ({ complete: false, offset: 0 }),
    send: async () => { sends++; return { status: 308, range: null, body: {} }; } }), /retry to resume/);
  assert.equal(sends, 3);
});

test("invalid and out-of-bounds acknowledgements are rejected", async () => {
  assert.throws(() => acknowledgedOffset("bytes=0-999", 10), /invalid/);
  assert.throws(() => acknowledgedOffset("nonsense", 10), /invalid/);
  await assert.rejects(uploadChunks({ file: file(CHUNK * 3), uploadUrl: "google", status: unexpectedStatus,
    send: async () => ({ status: 308, range: `bytes=0-${CHUNK * 2}`, body: {} }) }), /unexpected/);
});

test("a browser replay rejected for an old range recovers only with confirmed progress", async () => {
  let sends = 0;
  await uploadChunks({ file: file(CHUNK), uploadUrl: "google", status: async () => ({ complete: false, offset: 1024 * 1024 }),
    send: async (_url, _body, range) => {
      if (++sends === 1) return { status: 400, range: null, body: { error: "Wrong range" } };
      assert.equal(range, `bytes 1048576-${CHUNK - 1}/${CHUNK}`);
      return { status: 200, range: null, body: { id: "recovered" } };
    } });
  await assert.rejects(uploadChunks({ file: file(10), uploadUrl: "google", status: async () => ({ complete: false, offset: 0 }),
    send: async () => ({ status: 400, range: null, body: { error: "Invalid request" } }) }), /Invalid request/);
});
