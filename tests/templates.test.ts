import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTemplateFile } from "../lib/templates";
import { DOC_TYPE_META, CREATABLE_DOC_TYPES } from "../lib/constants";
import type { DriveFileInfo } from "../lib/google/types";

const source: DriveFileInfo = {
  id: "original", name: "Rehearsal report", mimeType: DOC_TYPE_META.DOC.mimeType!,
  webViewLink: "https://docs.google.com/document/d/original/edit", canCopy: true,
};

test("templates accept each supported native Google file type", async () => {
  for (const type of CREATABLE_DOC_TYPES) {
    const file = { ...source, mimeType: DOC_TYPE_META[type].mimeType! };
    assert.equal(await resolveTemplateFile({ getFile: async () => file }, file.id, type), file);
  }
});

test("template shortcuts resolve to the source that must be copied", async () => {
  const requests: string[] = [];
  const file = await resolveTemplateFile({ getFile: async (id) => {
    requests.push(id);
    return id === "shortcut"
      ? { ...source, id, mimeType: "application/vnd.google-apps.shortcut", shortcutTargetId: source.id }
      : source;
  } }, "shortcut", "DOC");
  assert.equal(file.id, source.id);
  assert.deepEqual(requests, ["shortcut", "original"]);
});

test("unusable template sources are rejected with actionable errors", async () => {
  const cases: Array<[DriveFileInfo | null, RegExp]> = [
    [null, /missing/],
    [{ ...source, trashed: true }, /trash/],
    [{ ...source, canCopy: false }, /not allowed.*copy/],
    [{ ...source, mimeType: "application/vnd.google-apps.folder" }, /must be/],
    [{ ...source, mimeType: DOC_TYPE_META.SHEET.mimeType! }, /must be/],
    [{ ...source, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, /must be/],
  ];
  for (const [file, error] of cases) {
    await assert.rejects(resolveTemplateFile({ getFile: async () => file }, "source", "DOC"), error);
  }
});

test("broken and cyclic shortcuts cannot hang template saving", async () => {
  await assert.rejects(resolveTemplateFile({ getFile: async (id) => ({
    ...source, id, mimeType: "application/vnd.google-apps.shortcut", shortcutTargetId: id,
  }) }, "shortcut", "DOC"), /shortcut could not be resolved/);
});
