import { printTabToPdf } from "./pdf.js";

// The preview shows the PDF from a URL in the extension's own origin: a blob: URL
// would inherit the extension pages' CSP (object-src 'self'), which blocks Chrome's
// PDF viewer. preview.js stores the file in Cache Storage (which only accepts
// http(s) keys, hence the placeholder origin) and it is served at /preview-files/.
const PREVIEW_CACHE_ORIGIN = "https://preview-files.invalid";

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith("/preview-files/")) return;
  event.respondWith(
    caches.match(PREVIEW_CACHE_ORIGIN + url.pathname).then((response) => response || new Response("Not found", { status: 404 })),
  );
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tab = sender.tab;
  if (!tab?.id) return;

  if (request.action === "PRINT_TO_PDF") {
    printTabToPdf(tab.id, request.options || {}).then(
      (data) => sendResponse({ data }),
      (err) => sendResponse({ error: err?.message || String(err) }),
    );
    return true; // Respond asynchronously.
  }

  if (request.action === "OPEN_PREVIEW") {
    // Content scripts can't open tabs, so the service worker opens the preview
    // next to the page it was exported from.
    const params = new URLSearchParams({ ...request.params, tabId: String(tab.id) });
    chrome.tabs
      .create({
        url: `${chrome.runtime.getURL("preview.html")}?${params}`,
        index: tab.index + 1,
        openerTabId: tab.id,
      })
      .then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ error: err?.message || String(err) }),
      );
    return true;
  }
});
