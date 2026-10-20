import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  PDFDocument,
  StandardFonts,
  degrees,
} from "../vendor/pdf-lib.esm.min.js";
import {
  parseRange,
  validateFiles,
  normalizedRotation,
  loadPDF,
  exportPDF,
  LIMITS,
} from "../src/core.js";
const fixtures = new URL("./fixtures/", import.meta.url);
await fs.mkdir(fixtures, { recursive: true });
async function make(labels) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const [i, label] of labels.entries()) {
    const p = d.addPage([400 + i * 20, 600 + i * 10]);
    p.drawText(label, { x: 40, y: 500, size: 24, font: f });
  }
  return d;
}
const alpha = await make(["ALPHA ONE", "ALPHA TWO", "ALPHA THREE"]);
alpha.getPage(1).setRotation(degrees(90));
const beta = await make(["BETA ONE", "BETA TWO"]);
await fs.writeFile(new URL("alpha.pdf", fixtures), await alpha.save());
await fs.writeFile(new URL("beta.pdf", fixtures), await beta.save());
const source = new Map([
  ["a", { kind: "pdf", doc: alpha }],
  ["b", { kind: "pdf", doc: beta }],
]);
const e = (sourceId, pageIndex, rotation = 0, selected = true) => ({
  sourceId,
  pageIndex,
  rotation,
  selected,
});
test("blank range means all pages", () =>
  assert.deepEqual(parseRange(" ", 3), [0, 1, 2]));
test("range preserves explicit order", () =>
  assert.deepEqual(parseRange("3, 1-2", 3), [2, 0, 1]));
test("whitespace range", () =>
  assert.deepEqual(parseRange(" 2 - 3 ", 3), [1, 2]));
for (const range of [
  "0",
  "4",
  "3-1",
  "-1",
  "1.5",
  "1,",
  "1,,2",
  "1,1",
  "1-2,2-3",
  "1e2",
  "foo",
  "1-999999999",
])
  test(`reject range ${range}`, () =>
    assert.throws(() => parseRange(range, 3)));
test("empty source range rejects", () =>
  assert.throws(() => parseRange("", 0)));
for (const [n, want] of [
  [0, 0],
  [90, 90],
  [-90, 270],
  [450, 90],
  [720, 0],
])
  test(`rotation ${n}`, () => assert.equal(normalizedRotation(n), want));
test("reject arbitrary rotation", () =>
  assert.throws(() => normalizedRotation(15)));
const f = (name = "a.pdf", size = 100) => ({ name, size });
test("PDF file accepted", () =>
  assert.doesNotThrow(() => validateFiles([f()], "merge")));
test("uppercase JPG accepted", () =>
  assert.doesNotThrow(() => validateFiles([f("X.JPG")], "images")));
test("non-PDF rejected", () =>
  assert.throws(() => validateFiles([f("a.txt")], "merge")));
test("wrong image rejected", () =>
  assert.throws(() => validateFiles([f("a.webp")], "images")));
test("zero bytes rejected", () =>
  assert.throws(() => validateFiles([f("a.pdf", 0)], "merge")));
test("combined byte limit", () =>
  assert.throws(() => validateFiles([f("a.pdf", 100)], "merge", LIMITS.bytes)));
test("file count limit", () =>
  assert.throws(() => validateFiles([f()], "merge", 0, 30)));
test("empty selection", () => assert.throws(() => validateFiles([], "merge")));
test("real PDF loads", async () =>
  assert.equal((await loadPDF(await alpha.save())).getPageCount(), 3));
test("malformed PDF rejected", async () =>
  assert.rejects(loadPDF(new Uint8Array([1, 2, 3])), /could not be read/));
test("oversized page count rejected", async () => {
  const d = await PDFDocument.create();
  for (let i = 0; i < 201; i++) d.addPage();
  await assert.rejects(loadPDF(await d.save()), /200 pages/);
});
test("merge retains page order and distinct dimensions", async () => {
  const bytes = await exportPDF([e("a", 0), e("b", 1), e("a", 2)], source);
  await fs.writeFile(new URL("core-merged.pdf", fixtures), bytes);
  const d = await PDFDocument.load(bytes);
  assert.equal(d.getPageCount(), 3);
  assert.deepEqual(
    d.getPages().map((p) => p.getSize()),
    [
      { width: 400, height: 600 },
      { width: 420, height: 610 },
      { width: 440, height: 620 },
    ],
  );
});
test("rotation adds to original page rotation", async () => {
  const bytes = await exportPDF([e("a", 1, 90)], source);
  const d = await PDFDocument.load(bytes);
  assert.equal(d.getPage(0).getRotation().angle, 180);
});
test("selection omission and reorder", async () => {
  const bytes = await exportPDF(
    [e("a", 2), e("a", 0, 0, false), e("a", 1)],
    source,
  );
  const d = await PDFDocument.load(bytes);
  assert.equal(d.getPageCount(), 2);
  assert.equal(d.getPage(0).getWidth(), 440);
});
test("export no selected pages rejects", async () =>
  assert.rejects(exportPDF([e("a", 0, 0, false)], source), /Select at least/));
test("missing source rejects", async () =>
  assert.rejects(exportPDF([e("missing", 0)], source), /source file/));
test("invalid page index rejects", async () =>
  assert.rejects(exportPDF([e("a", 9)], source), /Invalid source page/));
test("bad page size rejects", async () =>
  assert.rejects(
    exportPDF([e("a", 0)], source, { pageSize: "bogus" }),
    /Unsupported/,
  ));
