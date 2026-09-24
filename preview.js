import { printTabToPdf } from "./pdf.js";

// Preview of the PDF before download. The page being exported (content.js)
// keeps its print layout applied while this tab is connected to it, so changing
// a setting re-applies the layout there and prints again.

const params = new URLSearchParams(location.search);
const sourceTabId = Number(params.get("tabId"));

const nameEl = document.getElementById("name");
const formatEl = document.getElementById("format");
const orientationEl = document.getElementById("orientation");
const marginEl = document.getElementById("margin");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("download");
const cancelBtn = document.getElementById("cancel");
const fallbackBtn = document.getElementById("fallback");
const viewer = document.getElementById("viewer");
const overlay = document.getElementById("overlay");

const FORMAT_LABELS = { a4: "A4", a3: "A3", letter: "Letter", legal: "Legal" };

nameEl.value = params.get("name") || "export";
formatEl.value = params.get("format") || "a4";
orientationEl.value = params.get("orientation") || "auto";
marginEl.value = params.get("margin") || "10";
document.title = `Preview – ${nameEl.value}`;

let pdfUrl = null;
let pdfBlob = null;
let live = true;
// Cache holding this preview's PDF, served by background.js at /preview-files/.
const sessionId = crypto.randomUUID();
const cacheName = `pdf-preview-${sessionId}`;
let renderCount = 0;
// Cache Storage only accepts http(s) keys; background.js maps the path back.
const PREVIEW_CACHE_ORIGIN = "https://preview-files.invalid";
let closing = false;

// --- Connection to the exported page --------------------------------------------

const pendingLayouts = new Map();
let nextLayoutId = 0;

const port = Number.isInteger(sourceTabId)
  ? chrome.tabs.connect(sourceTabId, { name: "pdf-preview", frameId: 0 })
  : null;
port?.onMessage.addListener((msg) => {
  if (msg.type === "LAYOUT_READY") {
    pendingLayouts.get(msg.id)?.resolve(msg.layout);
    pendingLayouts.delete(msg.id);
  }
});
port?.onDisconnect.addListener(() => {
  void chrome.runtime.lastError; // The page may simply have gone away.
  live = false;
  for (const { reject } of pendingLayouts.values()) reject(new Error("The page was closed or reloaded."));
  pendingLayouts.clear();
  if (closing) return;
  for (const el of document.querySelectorAll(".setting")) el.disabled = true;
  fallbackBtn.classList.remove("visible");
  overlay.hidden = true;
  setStatus(
    pdfUrl
      ? "The page was closed or reloaded: settings are locked, but you can still download this PDF."
      : "The page was closed or reloaded before the PDF was generated. Export it again.",
    !pdfUrl,
  );
});

function applyLayout(options) {
  return new Promise((resolve, reject) => {
    if (!live) return reject(new Error("The page was closed or reloaded."));
    const id = ++nextLayoutId;
    pendingLayouts.set(id, { resolve, reject });
    port.postMessage({ type: "APPLY_LAYOUT", id, options });
  });
}

// --- Rendering ----------------------------------------------------------------
// One render at a time (the debugger can only attach once per tab); if settings
// change during a render, render again with the latest ones.

let rendering = false;
let dirty = false;

function scheduleRender() {
  dirty = true;
  if (!rendering) renderLoop();
}

async function renderLoop() {
  rendering = true;
  while (dirty && live) {
    dirty = false;
    await renderOnce();
  }
  rendering = false;
}

async function renderOnce() {
  const options = readOptions();
  overlay.hidden = false;
  downloadBtn.disabled = true;
  fallbackBtn.classList.remove("visible");
  setStatus("Generating…");

  try {
    const layout = await applyLayout(options);
    const base64 = await printTabToPdf(sourceTabId, layout);
    if (dirty) return; // Newer settings are waiting; skip showing this one.
    await showPdf(base64, layout, options);
  } catch (err) {
    if (!live) return; // Reported by onDisconnect.
    console.error(err);
    overlay.hidden = true;
    setStatus(`Could not generate the PDF: ${err?.message || err}`, true);
    fallbackBtn.classList.add("visible");
    downloadBtn.disabled = !pdfUrl;
  }
}

async function showPdf(base64, layout, options) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  pdfBlob = new Blob([bytes], { type: "application/pdf" });

  // A fresh path per render so the viewer never shows a stale copy; the file
  // name in the path is what the viewer displays as the title.
  const path = `/preview-files/${sessionId}/${++renderCount}/${encodeURIComponent(fileName())}`;
  const cache = await caches.open(cacheName);
  if (pdfUrl) await cache.delete(PREVIEW_CACHE_ORIGIN + new URL(pdfUrl).pathname);
  await cache.put(PREVIEW_CACHE_ORIGIN + path, new Response(pdfBlob, { headers: { "Content-Type": "application/pdf" } }));
  pdfUrl = location.origin + path;
  viewer.src = `${pdfUrl}#view=FitH`;

  overlay.hidden = true;
  downloadBtn.disabled = false;
  const pages = countPages(bytes);
  const orientation = layout.landscape ? "landscape" : "portrait";
  const auto = options.orientation === "auto" ? " (auto)" : "";
  setStatus(`${pages} page${pages === 1 ? "" : "s"} · ${FORMAT_LABELS[layout.format] || layout.format} ${orientation}${auto}`);
}

// Page objects in Chrome's PDFs are written uncompressed as "/Type /Page".
function countPages(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length || 1;
}

function readOptions() {
  const margin = Number.parseFloat(marginEl.value);
  return {
    format: formatEl.value,
    orientation: orientationEl.value,
    margin: Number.isFinite(margin) && margin >= 0 ? Math.min(margin, 50) : 10,
  };
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

// --- Settings -----------------------------------------------------------------

let marginTimer = null;

for (const el of [formatEl, orientationEl]) {
  el.addEventListener("change", onSettingsChanged);
}
// Wait for the user to stop typing before re-rendering.
marginEl.addEventListener("input", () => {
  clearTimeout(marginTimer);
  marginTimer = setTimeout(onSettingsChanged, 500);
});

function onSettingsChanged() {
  clearTimeout(marginTimer);
  // Remember the choice for the next export, like the popup does.
  chrome.storage.sync.set(readOptions());
  scheduleRender();
}

// --- Actions ------------------------------------------------------------------

function fileName() {
  const base = nameEl.value.replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\.pdf$/i, "") || "export";
  return `${base}.pdf`;
}

downloadBtn.addEventListener("click", () => {
  if (!pdfBlob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(pdfBlob);
  link.download = fileName();
  link.click();
  // Give the download a moment to start before closing the tab.
  setTimeout(closePreview, 800);
});

cancelBtn.addEventListener("click", closePreview);

fallbackBtn.addEventListener("click", async () => {
  // Chrome's print dialog uses the same layout; "Save as PDF" there.
  await chrome.tabs.update(sourceTabId, { active: true });
  port.postMessage({ type: "PRINT_DIALOG", name: fileName().replace(/\.pdf$/, "") });
  closePreview();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePreview();
  if (e.key === "Enter" && e.target === nameEl && !downloadBtn.disabled) downloadBtn.click();
});

async function closePreview() {
  if (closing) return;
  closing = true;
  await caches.delete(cacheName).catch(() => {});
  // Closing this tab disconnects the port, which restores the page.
  await chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
}

// Also clean up if the tab is closed some other way (e.g. Ctrl+W).
addEventListener("pagehide", () => caches.delete(cacheName));

if (Number.isInteger(sourceTabId)) {
  scheduleRender();
} else {
  live = false;
  overlay.hidden = true;
  setStatus("Nothing to preview. Start an export from the extension's popup.", true);
}
