import { PDFDocument, degrees } from "../vendor/pdf-lib.esm.min.js";
export const LIMITS = {
  bytes: 50 * 1024 * 1024,
  files: 30,
  pages: 200,
  imagePixels: 25000000,
};
export function parseRange(text, count) {
  if (!Number.isInteger(count) || count < 1) throw Error("No pages available.");
  if (!text.trim()) return Array.from({ length: count }, (_, i) => i);
  const result = [];
  for (const token of text.split(",")) {
    const m = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("Use page numbers like 1, 3-5.");
    const a = Number(m[1]),
      b = Number(m[2] ?? m[1]);
    if (a < 1 || b > count || a > b)
      throw Error(
        `Choose pages between 1 and ${count}; ranges must go forwards.`,
      );
    for (let i = a; i <= b; i++) {
      if (result.includes(i - 1)) throw Error("Choose each page only once.");
      result.push(i - 1);
    }
  }
  return result;
}
export function validateFiles(
  files,
  mode,
  existingBytes = 0,
  existingCount = 0,
) {
  if (!files.length) throw Error("Choose at least one file.");
  if (files.length + existingCount > LIMITS.files)
    throw Error("Use up to 30 files per workspace.");
  if (files.reduce((s, f) => s + f.size, existingBytes) > LIMITS.bytes)
    throw Error("Keep the workspace under 50 MiB. Try fewer or smaller files.");
  for (const f of files) {
    if (!f.size) throw Error(`${f.name}: this file is empty.`);
    if (!(mode === "images" ? /\.(png|jpe?g)$/i : /\.pdf$/i).test(f.name))
      throw Error(
        mode === "images"
          ? "Choose JPG or PNG images only."
          : "Choose PDF files only.",
      );
  }
}
export async function loadPDF(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e)))
      throw Error(
        "Password-protected PDFs are not supported. Export an unlocked copy in a trusted PDF app first.",
      );
    throw Error(
      "This PDF could not be read. It may be damaged or unsupported.",
    );
  }
  if (doc.isEncrypted)
    throw Error("Password-protected PDFs are not supported.");
  if (!doc.getPageCount()) throw Error("This PDF has no pages.");
  if (doc.getPageCount() > LIMITS.pages)
    throw Error("Use PDFs with at most 200 pages.");
  return doc;
}
export function normalizedRotation(deg) {
  if (!Number.isFinite(deg) || deg % 90 !== 0)
    throw Error("Rotation must be a multiple of 90 degrees.");
  return ((deg % 360) + 360) % 360;
}
export async function exportPDF(
  entries,
  sources,
  { pageSize = "a4", margin = 24 } = {},
) {
  const chosen = entries.filter((e) => e.selected);
  if (!chosen.length) throw Error("Select at least one page.");
  if (chosen.length > LIMITS.pages)
    throw Error("Export up to 200 pages at once.");
  if (!["a4", "original"].includes(pageSize))
    throw Error("Unsupported page size.");
  const out = await PDFDocument.create();
  out.setProducer("Paperlocal PDF / pdf-lib");
  out.setCreator("Paperlocal PDF");
  for (const entry of chosen) {
    const src = sources.get(entry.sourceId);
    if (!src) throw Error("A source file is missing. Choose the file again.");
    if (src.kind === "pdf") {
      if (
        !Number.isInteger(entry.pageIndex) ||
        entry.pageIndex < 0 ||
        entry.pageIndex >= src.doc.getPageCount()
      )
        throw Error("Invalid source page.");
      const [page] = await out.copyPages(src.doc, [entry.pageIndex]);
      out.addPage(page);
      page.setRotation(
        degrees(normalizedRotation(page.getRotation().angle + entry.rotation)),
      );
    } else {
      const img =
        src.mime === "image/png"
          ? await out.embedPng(src.bytes)
          : await out.embedJpg(src.bytes);
      let w, h;
      if (pageSize === "original") {
        w = img.width * 0.75;
        h = img.height * 0.75;
      } else {
        [w, h] = img.width > img.height ? [841.89, 595.28] : [595.28, 841.89];
      }
      const page = out.addPage([w, h]);
      const pad = pageSize === "original" ? 0 : margin;
      const scale = Math.min(
        (w - 2 * pad) / img.width,
        (h - 2 * pad) / img.height,
      );
      page.drawImage(img, {
        x: (w - img.width * scale) / 2,
        y: (h - img.height * scale) / 2,
        width: img.width * scale,
        height: img.height * scale,
      });
      page.setRotation(degrees(normalizedRotation(entry.rotation)));
    }
  }
  return out.save();
}
