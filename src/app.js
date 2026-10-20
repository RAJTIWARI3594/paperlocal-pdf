import {
  LIMITS,
  validateFiles,
  loadPDF,
  parseRange,
  exportPDF,
} from "./core.js";
import * as pdfjs from "../vendor/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "../vendor/pdf.worker.min.mjs",
  import.meta.url,
).href;
const $ = (s) => document.querySelector(s);
const descriptions = {
  merge: [
    "Good things come together.",
    "Add PDFs, put their pages in order, and save one tidy document.",
  ],
  extract: [
    "Just the pages you need.",
    "Choose a PDF, select a page range, and save it as a new document.",
  ],
  organize: [
    "A fresh order of things.",
    "Reorder pages, turn them the right way up, and leave out what you don’t need.",
  ],
  images: [
    "From camera roll to document.",
    "Turn JPG and PNG images into a single, easy-to-share PDF.",
  ],
};
let mode = "merge",
  sources = new Map(),
  entries = [],
  busy = false,
  counter = 0,
  generation = 0,
  totalBytes = 0,
  totalPixels = 0,
  previewUrls = new Set();
const observer = new IntersectionObserver(
  (list) => {
    for (const x of list)
      if (x.isIntersecting) {
        observer.unobserve(x.target);
        renderPreview(x.target);
      }
  },
  { rootMargin: "150px" },
);
function notice(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("error", error);
}
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll("button,input,select")
    .forEach((e) => (e.disabled = value));
  $("#dropzone").setAttribute("aria-busy", String(value));
  if (!value) updateButtons();
}
function updateButtons() {
  document
    .querySelectorAll('[data-action="up"]')
    .forEach((b, i) => (b.disabled = i === 0));
  document
    .querySelectorAll('[data-action="down"]')
    .forEach((b, i) => (b.disabled = i === entries.length - 1));
  $("#download").disabled = !entries.some((e) => e.selected);
}
function element(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
async function dispose() {
  generation++;
  observer.disconnect();
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls.clear();
  for (const s of sources.values()) {
    if (s.preview) await s.preview.destroy().catch(() => {});
  }
  sources.clear();
  entries = [];
  totalBytes = 0;
  totalPixels = 0;
  $("#files").value = "";
  $("#range").value = "";
  $("#editor").hidden = true;
  $("#pages").replaceChildren();
}
async function changeMode(next) {
  if (busy || next === mode) return;
  if (
    entries.length &&
    !confirm(
      "Switch tools and clear the current workspace? Your downloaded files will not be removed.",
    )
  )
    return;
  await dispose();
  mode = next;
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  $("#tool-title").textContent = descriptions[mode][0];
  $("#tool-description").textContent = descriptions[mode][1];
  $("#drop-title").textContent =
    mode === "images" ? "Drop your photos here" : "Drop your PDFs here";
  $("#files").accept =
    mode === "images"
      ? "image/jpeg,image/png,.jpg,.jpeg,.png"
      : "application/pdf,.pdf";
  $("#size-label").hidden = mode !== "images";
  $("#range-box").hidden = mode === "images";
  $("#filename").value =
    `paperlocal-${mode === "images" ? "photos" : mode === "merge" ? "merged" : mode === "extract" ? "extracted" : "organized"}.pdf`;
  notice("Ready when you are. Original files are never changed.");
}
function selectionChanged() {
  const selected = entries.filter((e) => e.selected).length;
  $("#selection-count").textContent =
    `${selected} of ${entries.length} pages selected`;
  updateButtons();
}
function draw() {
  observer.disconnect();
  const list = $("#pages");
  list.replaceChildren();
  $("#editor").hidden = !entries.length;
  $("#page-count").textContent =
    `${entries.length} ${mode === "images" ? "photo" : "page"}${entries.length === 1 ? "" : "s"} · ${sources.size} file${sources.size === 1 ? "" : "s"}`;
  entries.forEach((e, i) => {
    const src = sources.get(e.sourceId);
    const card = element(
      "article",
      "page-card" + (e.selected ? "" : " unselected"),
    );
    card.dataset.id = e.id;
    const preview = element("div", "page-preview");
    preview.dataset.id = e.id;
    preview.append(
      element(
        "span",
        "preview-placeholder",
        mode === "images" ? "Photo" : String(e.pageIndex + 1),
      ),
    );
    if (e.thumbnail) {
      const img = element("img");
      img.src = e.thumbnail;
      img.alt = "";
      img.style.transform = `rotate(${e.rotation}deg)`;
      preview.replaceChildren(img);
    } else observer.observe(preview);
    card.append(preview);
    const meta = element("div", "page-meta"),
      label = element("label");
    const box = element("input");
    box.type = "checkbox";
    box.checked = e.selected;
    box.setAttribute("aria-label", `Include output page ${i + 1}`);
    box.addEventListener("change", () => {
      e.selected = box.checked;
      card.classList.toggle("unselected", !box.checked);
      selectionChanged();
    });
    label.append(box, document.createTextNode(`Page ${i + 1}`));
    meta.append(label, element("span", "rotation-label", `${e.rotation}°`));
    card.append(meta);
    const name = element(
      "small",
      "",
      `${src.name}${src.kind === "pdf" ? ` · source page ${e.pageIndex + 1}` : ""}`,
    );
    name.title = name.textContent;
    card.append(name);
    const tools = element("div", "page-tools");
    for (const [action, icon, title] of [
      ["up", "←", "Move earlier"],
      ["rotate", "↻", "Rotate clockwise"],
      ["down", "→", "Move later"],
    ]) {
      const b = element("button", "", icon);
      b.dataset.action = action;
      b.setAttribute("aria-label", `${title}: output page ${i + 1}`);
      b.title = title;
      b.addEventListener("click", () => {
        if (busy) return;
        if (action === "rotate") {
          e.rotation = (e.rotation + 90) % 360;
        } else {
          const j = i + (action === "up" ? -1 : 1);
          if (j < 0 || j >= entries.length) return;
          [entries[i], entries[j]] = [entries[j], entries[i]];
        }
        draw();
        const target = $(`[data-id="${e.id}"] button[data-action="${action}"]`);
        target?.focus();
      });
      tools.append(b);
    }
    card.append(tools);
    list.append(card);
  });
  selectionChanged();
}
async function renderPreview(container) {
  const gen = generation,
    e = entries.find((e) => e.id === container.dataset.id);
  if (!e) return;
  const src = sources.get(e.sourceId);
  try {
    let url;
    if (src.kind === "image") {
      url = URL.createObjectURL(new Blob([src.bytes], { type: src.mime }));
    } else {
      const page = await src.preview.getPage(e.pageIndex + 1);
      const initial = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(180 / initial.width, 180 / initial.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw Error("Preview unavailable");
      url = URL.createObjectURL(blob);
      page.cleanup();
    }
    if (gen !== generation || !entries.includes(e)) {
      URL.revokeObjectURL(url);
      return;
    }
    previewUrls.add(url);
    e.thumbnail = url;
    if (container.isConnected) {
      const img = element("img");
      img.src = url;
      img.alt = "";
      img.style.transform = `rotate(${e.rotation}deg)`;
      container.replaceChildren(img);
    }
  } catch {
    if (container.isConnected)
      container.replaceChildren(
        element("span", "preview-placeholder", "No preview"),
      );
  }
}
async function normalizeImage(file) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (bitmap.width * bitmap.height > LIMITS.imagePixels)
      throw Error("Each photo must be 25 megapixels or smaller.");
    if (bitmap.width * bitmap.height + totalPixels > 50000000)
      throw Error(
        "Keep photos under 50 megapixels combined. Try fewer images.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const mime = /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mime, 0.95),
    );
    if (!blob) throw Error("This image could not be decoded.");
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime,
      pixels: bitmap.width * bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
async function addFiles(fileList) {
  if (busy) return;
  const files = Array.from(fileList);
  if (!files.length) return;
  const pending = [];
  let loadedPages = 0,
    addedPixels = 0;
  try {
    validateFiles(files, mode, totalBytes, sources.size);
    if (
      ["extract", "organize"].includes(mode) &&
      sources.size + files.length > 1
    )
      throw Error(
        "This tool uses one PDF at a time. Clear files first, or use Merge PDFs.",
      );
    setBusy(true);
    notice("Reading files locally…");
    for (const file of files) {
      const id = String(++counter);
      if (mode === "images") {
        const img = await normalizeImage(file);
        if (totalPixels + addedPixels + img.pixels > 50000000)
          throw Error("Keep photos under 50 megapixels combined.");
        addedPixels += img.pixels;
        pending.push({ id, name: file.name, kind: "image", ...img });
        loadedPages++;
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await loadPDF(bytes);
        loadedPages += doc.getPageCount();
        if (entries.length + loadedPages > LIMITS.pages)
          throw Error("Keep the workspace to 200 pages or fewer.");
        let preview = null;
        try {
          preview = await pdfjs.getDocument({
            data: bytes.slice(),
            isEvalSupported: false,
            standardFontDataUrl: new URL(
              "../vendor/standard_fonts/",
              import.meta.url,
            ).href,
            useSystemFonts: true,
          }).promise;
        } catch {}
        pending.push({ id, name: file.name, kind: "pdf", bytes, doc, preview });
      }
    }
    if (entries.length + loadedPages > LIMITS.pages)
      throw Error("Keep the workspace to 200 pages or fewer.");
    for (const src of pending) {
      sources.set(src.id, src);
      const n = src.kind === "pdf" ? src.doc.getPageCount() : 1;
      for (let i = 0; i < n; i++)
        entries.push({
          id: `${src.id}-${i}`,
          sourceId: src.id,
          pageIndex: i,
          selected: true,
          rotation: 0,
          thumbnail: null,
        });
    }
    totalBytes += files.reduce((s, f) => s + f.size, 0);
    totalPixels += addedPixels;
    draw();
    notice(
      `Added ${files.length} file${files.length === 1 ? "" : "s"} locally. Select and arrange your pages below.`,
    );
  } catch (e) {
    for (const src of pending)
      if (src.preview) await src.preview.destroy().catch(() => {});
    notice(e.message || "Unable to read these files. Try another file.", true);
  } finally {
    setBusy(false);
    $("#files").value = "";
  }
}
$("#files").addEventListener("change", (e) => addFiles(e.target.files));
for (const b of document.querySelectorAll("[data-mode]"))
  b.addEventListener("click", () => changeMode(b.dataset.mode));
const dz = $("#dropzone");
for (const type of ["dragenter", "dragover"])
  dz.addEventListener(type, (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
for (const type of ["dragleave", "drop"])
  dz.addEventListener(type, (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
  });
dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
$("#reset").addEventListener("click", async () => {
  if (confirm("Clear all files from this workspace?")) {
    await dispose();
    notice("Workspace cleared. Downloads on your device are unchanged.");
  }
});
$("#select-all").addEventListener("click", () => {
  entries.forEach((e) => (e.selected = true));
  draw();
});
$("#select-none").addEventListener("click", () => {
  entries.forEach((e) => (e.selected = false));
  draw();
});
$("#apply-range").addEventListener("click", () => {
  try {
    const indexes = parseRange($("#range").value, entries.length);
    const chosen = indexes.map((i) => entries[i]);
    const rest = entries.filter((_, i) => !indexes.includes(i));
    chosen.forEach((e) => (e.selected = true));
    rest.forEach((e) => (e.selected = false));
    entries = [...chosen, ...rest];
    draw();
    notice(
      `${chosen.length} pages selected, in the requested order. Page numbers now reflect the new order.`,
    );
    $("#range").value = "";
  } catch (e) {
    notice(e.message, true);
  }
});
$("#download").addEventListener("click", async () => {
  if (busy) return;
  try {
    setBusy(true);
    notice("Building your PDF on this device…");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bytes = await exportPDF(entries, sources, {
      pageSize: $("#page-size").value,
    });
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    let name = $("#filename")
      .value.trim()
      .replace(/[\\/\x00-\x1f:*?"<>|]/g, "-");
    if (!name) name = "paperlocal.pdf";
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice(
      "Your PDF is ready. Check your browser downloads, then review the file before sharing.",
    );
  } catch (e) {
    notice(e.message || "Export failed. Try fewer or smaller files.", true);
  } finally {
    setBusy(false);
  }
});
window.addEventListener("pagehide", () => {
  for (const u of previewUrls) URL.revokeObjectURL(u);
});
