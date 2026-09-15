import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { uploadFile } from "../lib/upload-client";

const entries = new Map<string, string>();
let requests: Array<{ url: string; body: any }>;
let sendCount: number;
let responder: (url: string, body: any) => Response | Promise<Response>;
const testFile = (name: string) => ({ name, size: 5 * 1024 ** 3, lastModified: 123, type: "video/mp4",
  slice: (start: number, end: number) => ({ size: end - start }) as Blob }) as File;
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }

beforeEach(() => {
  entries.clear(); requests = []; sendCount = 0;
  Object.assign(globalThis, {
    localStorage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) },
    fetch: async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); requests.push({ url, body }); return responder(url, body);
    },
    XMLHttpRequest: class {
      status = 200; responseText = '{"id":"drive-recording"}'; timeout = 0;
      upload: { onprogress?: (event: unknown) => void } = {};
      onload?: () => void;
      open(_method: string, url: string) { assert(!url.includes("proxy")); }
      setRequestHeader() {}
      getResponseHeader() { return null; }
      send(body: Blob) { assert(body.size <= 8 * 1024 ** 2); sendCount++; queueMicrotask(() => this.onload?.()); }
    },
  });
});

test("retry after finalization failure reuses the uploaded file rather than sending bytes again", async () => {
  let finishCount = 0;
  responder = (url) => {
    if (url.endsWith("/start")) return json({ uploadId: "pending", kind: "resumable", uploadUrl: "https://google.test/session" });
    if (url.endsWith("/finish")) return ++finishCount === 1 ? json({ error: "Fix the category", retryable: false }, 400) :
      json({ documentId: "upload_pending", title: "Recording", webViewLink: "drive" });
    throw new Error(`Unexpected request ${url}`);
  };
  const options = { file: testFile("recording.mp4"), start: { categoryId: "scripts", title: "Recording" } };
  await assert.rejects(uploadFile(options), /Fix the category/);
  assert.equal(sendCount, 1);
  assert.equal(entries.size, 1);
  assert(![...entries.values()][0].includes("google.test"));
  const result = await uploadFile(options);
  assert.equal(result.documentId, "upload_pending"); assert.equal(sendCount, 1);
  assert.equal(requests.filter(({ url }) => url.endsWith("/start")).length, 1);
  assert.equal(entries.size, 0);
});

test("cached session reselect authenticates through status and skips an already completed upload", async () => {
  const file = testFile("reload.mp4"), start = { categoryId: "scripts" };
  const key = "hub-upload-v2:" + JSON.stringify([file.name, file.size, file.lastModified, [["categoryId", "scripts"]]]);
  entries.set(key, JSON.stringify({ uploadId: "saved", kind: "resumable", createdAt: Date.now() }));
  responder = (url, body) => {
    assert.equal(body.uploadId, "saved");
    if (url.endsWith("/status")) return json({ complete: true, offset: file.size, fileId: "drive-recording" });
    if (url.endsWith("/finish")) return json({ documentId: "upload_saved", title: "Recording", warnings: [] });
    throw new Error("Should not start another upload");
  };
  assert.equal((await uploadFile({ file, start })).documentId, "upload_saved");
  assert.equal(sendCount, 0); assert.equal(entries.size, 0);
});

test("expired or unauthorized saved sessions are discarded without uploading to them", async () => {
  const file = testFile("expired.mp4"), start = {};
  const key = "hub-upload-v2:" + JSON.stringify([file.name, file.size, file.lastModified, []]);
  entries.set(key, JSON.stringify({ uploadId: "expired", kind: "resumable", createdAt: Date.now() }));
  responder = () => json({ error: "Expired" }, 410);
  await assert.rejects(uploadFile({ file, start }), /Expired/);
  assert.equal(sendCount, 0); assert.equal(entries.size, 0);
});

test("duplicate clicks share one upload operation", async () => {
  responder = (url) => url.endsWith("/start") ? json({ uploadId: "one", kind: "resumable", uploadUrl: "https://google.test/session" }) :
    json({ documentId: "upload_one", title: "Recording", warnings: [] });
  const options = { file: testFile("double.mp4"), start: {} };
  const [one, two] = await Promise.all([uploadFile(options), uploadFile(options)]);
  assert.equal(one.documentId, two.documentId); assert.equal(sendCount, 1);
  assert.equal(requests.filter(({ url }) => url.endsWith("/start")).length, 1);
});


test("the UI distinguishes transferred bytes from hub finalization", async () => {
  const stages: string[] = [];
  responder = (url) => {
    if (url.endsWith("/start")) return json({ uploadId: "stages", kind: "resumable", uploadUrl: "https://google.test/session" });
    assert.deepEqual(stages, ["finalizing"]);
    return json({ documentId: "upload_stages", title: "Recording", warnings: [] });
  };
  await uploadFile({ file: testFile("stages.mp4"), start: {}, onFinalizing: () => stages.push("finalizing"),
    onProgress: pct => { if (pct === 100) stages.push("done"); } });
  assert.deepEqual(stages, ["finalizing", "done"]);
});
