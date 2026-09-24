(() => {
  // Injected on demand by popup.js, which first sends a PING to check for a live copy.
  const Z_TOP = "2147483647";
  const ACCENT = "#2563eb";

  let isSelecting = false;
  let isExporting = false;
  let hoveredElement = null;
  // Elements visited with ArrowUp, so ArrowDown can walk back down.
  let childTrail = [];
  let exportOptions = {};
  let overlay = null;
  let label = null;
  let toast = null;
  let toastTimer = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PING") {
      sendResponse(true);
    } else if (request.action === "ENABLE_SELECTION") {
      exportOptions = request.options || {};
      startSelectionMode();
      sendResponse({ ok: true });
    }
  });

  function startSelectionMode() {
    if (isSelecting) return;
    // Starting a new export ends a preview that is still open for this page.
    if (previewElement) endPreview();
    if (isExporting) return;
    isSelecting = true;
    createOverlay();
    showToast("Click an element to export · ↑/↓ parent/child · Enter export · Esc cancel");

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    // Swallow press events so the page doesn't react to the selecting click.
    document.addEventListener("mousedown", swallowEvent, true);
    document.addEventListener("mouseup", swallowEvent, true);
    document.addEventListener("pointerdown", swallowEvent, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", updateOverlay, true);
    window.addEventListener("resize", updateOverlay);
  }

  function stopSelectionMode() {
    isSelecting = false;
    hoveredElement = null;
    childTrail = [];
    overlay?.remove();
    label?.remove();
    overlay = label = null;
    hideToast();

    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("mousedown", swallowEvent, true);
    document.removeEventListener("mouseup", swallowEvent, true);
    document.removeEventListener("pointerdown", swallowEvent, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", updateOverlay, true);
    window.removeEventListener("resize", updateOverlay);
  }

  function createOverlay() {
    overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: Z_TOP,
      border: `2px dashed ${ACCENT}`,
      background: "rgba(37, 99, 235, 0.08)",
      boxSizing: "border-box",
      display: "none",
    });

    label = document.createElement("div");
    Object.assign(label.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: Z_TOP,
      background: ACCENT,
      color: "#fff",
      font: "12px/1.4 system-ui, sans-serif",
      padding: "2px 6px",
      borderRadius: "3px",
      whiteSpace: "nowrap",
      display: "none",
    });

    document.documentElement.append(overlay, label);
  }

  function setHovered(element) {
    hoveredElement = element;
    updateOverlay();
  }

  function updateOverlay() {
    if (!overlay || !hoveredElement) return;
    const rect = hoveredElement.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    label.textContent = `${describe(hoveredElement)} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    label.style.display = "block";
    label.style.left = `${Math.max(0, rect.left)}px`;
    label.style.top = rect.top > 22 ? `${rect.top - 22}px` : `${Math.max(0, rect.top) + 2}px`;
  }

  function describe(element) {
    let text = element.tagName.toLowerCase();
    if (element.id) text += `#${element.id}`;
    const classes = [...element.classList].slice(0, 2);
    if (classes.length) text += `.${classes.join(".")}`;
    return text;
  }

  function isOwnUi(element) {
    return element === overlay || element === label || element === toast;
  }

  function handleMouseMove(e) {
    const target = e.target;
    if (!(target instanceof Element) || isOwnUi(target)) return;
    if (target !== hoveredElement) {
      childTrail = [];
      setHovered(target);
    }
  }

  function swallowEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function handleClick(e) {
    swallowEvent(e);
    if (e.target instanceof Element && !isOwnUi(e.target)) {
      hoveredElement = e.target;
    }
    confirmSelection();
  }

  function handleKeyDown(e) {
    switch (e.key) {
      case "Escape":
        swallowEvent(e);
        stopSelectionMode();
        break;
      case "Enter":
        swallowEvent(e);
        confirmSelection();
        break;
      case "ArrowUp": {
        swallowEvent(e);
        const parent = hoveredElement?.parentElement;
        if (parent && parent !== document.documentElement) {
          childTrail.push(hoveredElement);
          setHovered(parent);
        }
        break;
      }
      case "ArrowDown":
        swallowEvent(e);
        if (childTrail.length) setHovered(childTrail.pop());
        break;
    }
  }

  function confirmSelection() {
    const element = hoveredElement;
    if (!element) return;
    stopSelectionMode();
    exportToPDF(element);
  }

  // The PDF is produced by Chrome's own print engine, which paginates like a
  // browser print: text is never cut through a line, headings stay with their
  // content, table headers repeat, and text stays selectable with working links.
  // A print-only stylesheet hides everything except the selected element.
  const TARGET_ATTR = "data-pdf-export-target";
  const ANCESTOR_ATTR = "data-pdf-export-ancestor";
  const KEEP_ATTR = "data-pdf-export-keep";
  const T = `[${TARGET_ATTR}]`;
  const A = `[${ANCESTOR_ATTR}]`;
  const PRINT_CSS = `
    @media print {
      /* Hide everything that isn't the selected element or one of its ancestors. */
      ${A} > :not(${A}):not(${T}) { display: none !important; }

      /* Ancestors become plain full-width wrappers, so the element starts at the
         top of the first page and nothing (fixed heights, overflow, transforms) clips it. */
      ${A} {
        margin: 0 !important; padding: 0 !important; border: 0 !important;
        box-shadow: none !important; position: static !important; float: none !important;
        transform: none !important; overflow: visible !important; contain: none !important;
        width: auto !important; min-width: 0 !important; max-width: none !important;
        height: auto !important; min-height: 0 !important; max-height: none !important;
      }
      ${A}:not(table, thead, tbody, tfoot, tr) { display: block !important; }

      ${T} {
        position: static !important; float: none !important; transform: none !important;
        margin: 0 !important; width: auto !important; max-width: 100% !important;
        height: auto !important; max-height: none !important; overflow: visible !important;
      }
      ${T}, ${T} * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

      /* Pagination hints: keep headings with what follows, don't split small blocks,
         avoid lone lines at the top/bottom of a page. */
      ${T} :is(h1, h2, h3, h4, h5, h6), ${T}:is(h1, h2, h3, h4, h5, h6) {
        break-after: avoid-page; break-inside: avoid;
      }
      ${T} :is(img, svg, canvas, video, figure, pre, blockquote, tr, li), [${KEEP_ATTR}] { break-inside: avoid; }
      ${T} :is(p, li, dd, blockquote) { orphans: 3; widows: 3; }
      ${T} thead { display: table-header-group; }
    }
  `;

  const PAPER_KEYWORDS = { a4: "A4", a3: "A3", letter: "letter", legal: "legal" };
  const PAPER_SIZES_MM = { a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4], legal: [215.9, 355.6] };
  // Boxes up to this fraction of the printable page height are never split.
  const KEEP_MAX_PAGE_FRACTION = 0.35;

  function buildBaseName() {
    const base = (document.title || location.hostname || "export")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "export";
    return `${base} - ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
  }

  async function exportToPDF(element) {
    isExporting = true;
    const baseName = buildBaseName();

    if (exportOptions.preview !== false) {
      try {
        await openPreview(element, baseName);
        return;
      } catch (err) {
        console.warn("Could not open the preview, downloading directly instead:", err);
        endPreview();
        isExporting = true;
      }
    }

    showToast("Generating PDF…");
    const layout = applyLayout(element, exportOptions);
    try {
      await waitForImages(element);
      const response = await chrome.runtime.sendMessage({ action: "PRINT_TO_PDF", options: layout });
      if (!response || response.error) throw new Error(response?.error || "No response from the extension.");
      downloadPdf(response.data, `${baseName}.pdf`);
      showToast("PDF downloaded", 2500);
    } catch (err) {
      // e.g. the debugger could not attach (another debugger is attached to this tab).
      // Fall back to Chrome's print dialog, which uses the same layout; "Save as PDF" there.
      console.warn("Direct PDF export failed, opening the print dialog instead:", err);
      hideToast();
      printWithDialog(baseName);
    } finally {
      releaseLayout();
      isExporting = false;
    }
  }

  function printWithDialog(baseName) {
    const title = document.title;
    document.title = baseName; // Chrome suggests the title as the file name.
    try {
      window.print();
    } finally {
      document.title = title;
    }
  }

  // --- Print layout -------------------------------------------------------------

  let currentLayout = null;

  // Applies (or re-applies with new settings) the print layout for `element` and
  // returns the resolved page settings for printTabToPdf.
  function applyLayout(element, options) {
    releaseLayout();
    const format = PAPER_SIZES_MM[options.format] ? options.format : "a4";
    const margin = Number.isFinite(options.margin) && options.margin >= 0 ? options.margin : 10;
    let orientation = options.orientation || "auto";
    if (orientation === "auto") {
      const rect = element.getBoundingClientRect();
      orientation = rect.width > rect.height ? "landscape" : "portrait";
    }
    currentLayout = preparePrintLayout(element, format, orientation, margin);
    return { format, landscape: orientation === "landscape", margin };
  }

  function releaseLayout() {
    currentLayout?.();
    currentLayout = null;
  }

  // --- Preview ------------------------------------------------------------------
  // The preview tab (preview.html) connects to this script with a port. While it
  // is connected the print layout stays applied, and the preview can re-apply it
  // with different settings. When the preview tab closes, the port disconnects
  // and the page goes back to normal.

  let previewElement = null;
  let previewPort = null;
  let previewTimer = null;

  async function openPreview(element, baseName) {
    previewElement = element;
    // Release the layout if the preview never connects (e.g. the tab failed to open).
    previewTimer = setTimeout(endPreview, 30_000);
    showToast("Opening preview…", 2500);
    const response = await chrome.runtime.sendMessage({
      action: "OPEN_PREVIEW",
      params: {
        name: baseName,
        format: exportOptions.format || "a4",
        orientation: exportOptions.orientation || "auto",
        margin: String(exportOptions.margin ?? 10),
      },
    });
    if (!response || response.error) throw new Error(response?.error || "No response from the extension.");
  }

  function endPreview() {
    clearTimeout(previewTimer);
    const port = previewPort;
    previewPort = null;
    previewElement = null;
    port?.disconnect();
    releaseLayout();
    isExporting = false;
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "pdf-preview") return;
    if (!previewElement || previewPort) {
      port.disconnect();
      return;
    }
    clearTimeout(previewTimer);
    previewPort = port;

    port.onMessage.addListener(async (msg) => {
      if (port !== previewPort) return;
      if (msg.type === "APPLY_LAYOUT") {
        const layout = applyLayout(previewElement, msg.options || {});
        await waitForImages(previewElement);
        try {
          port.postMessage({ type: "LAYOUT_READY", id: msg.id, layout });
        } catch {
          // The preview closed meanwhile.
        }
      } else if (msg.type === "PRINT_DIALOG") {
        printWithDialog(msg.name || buildBaseName());
      }
    });
    port.onDisconnect.addListener(() => {
      if (port === previewPort) endPreview();
    });
  });

  function preparePrintLayout(element, format, orientation, margin) {
    const marked = [element];
    element.setAttribute(TARGET_ATTR, "");
    // Walk up through shadow roots too, so a target inside a web component stays visible.
    for (let el = parentOf(element); el; el = parentOf(el)) {
      el.setAttribute(ANCESTOR_ATTR, "");
      marked.push(el);
    }

    // Lazy images below the fold would otherwise print as empty boxes.
    const lazyImages = [...element.querySelectorAll('img[loading="lazy"]')];
    if (element.matches('img[loading="lazy"]')) lazyImages.push(element);
    for (const img of lazyImages) img.loading = "eager";

    // Cards, banners, callouts... any small block with a visible box shouldn't be
    // split across pages. CSS can't select by size, so mark them here.
    const [paperW, paperH] = PAPER_SIZES_MM[format] || PAPER_SIZES_MM.a4;
    const printableMm = (orientation === "landscape" ? paperW : paperH) - 2 * margin;
    const keepMaxPx = (printableMm / 25.4) * 96 * KEEP_MAX_PAGE_FRACTION;
    for (const el of [element, ...element.querySelectorAll("*")]) {
      if (shouldKeepTogether(el, keepMaxPx)) {
        el.setAttribute(KEEP_ATTR, "");
        marked.push(el);
      }
    }

    const style = document.createElement("style");
    style.textContent = `${PRINT_CSS}
      @page { size: ${PAPER_KEYWORDS[format] || "A4"} ${orientation}; margin: ${margin}mm; }`;
    // Appended last so it wins over the page's own @page and print rules.
    document.documentElement.append(style);

    return () => {
      style.remove();
      for (const el of marked) {
        el.removeAttribute(TARGET_ATTR);
        el.removeAttribute(ANCESTOR_ATTR);
        el.removeAttribute(KEEP_ATTR);
      }
      for (const img of lazyImages) img.loading = "lazy";
    };
  }

  function shouldKeepTogether(el, maxHeight) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.display.startsWith("inline")) return false;
    const height = el.getBoundingClientRect().height;
    if (height === 0 || height > maxHeight) return false;
    const hasBackground =
      !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) || style.backgroundImage !== "none";
    const hasBorder = ["Top", "Right", "Bottom", "Left"].some(
      (side) => style[`border${side}Style`] !== "none" && parseFloat(style[`border${side}Width`]) > 0,
    );
    return hasBackground || hasBorder || style.boxShadow !== "none";
  }

  function parentOf(el) {
    return el.parentElement || el.getRootNode()?.host || null;
  }

  function waitForImages(element, timeout = 5000) {
    const images = [...element.querySelectorAll("img")];
    if (element instanceof HTMLImageElement) images.push(element);
    const pending = images
      .filter((img) => !img.complete)
      .map((img) => new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      }));
    return Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
  }

  function downloadPdf(base64, filename) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function showToast(message, duration = 0, isError = false) {
    clearTimeout(toastTimer);
    if (!toast) {
      toast = document.createElement("div");
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Z_TOP,
        pointerEvents: "none",
        color: "#fff",
        font: "13px/1.4 system-ui, sans-serif",
        padding: "8px 14px",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        maxWidth: "90vw",
        textAlign: "center",
      });
      document.documentElement.append(toast);
    }
    toast.style.background = isError ? "#b91c1c" : "#111827";
    toast.textContent = message;
    if (duration) toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toast?.remove();
    toast = null;
  }
})();
