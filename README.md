# Select & Export Div to PDF — Chrome Extension

A lightweight, Manifest V3 Chrome Extension that allows users to interactively pick any HTML container element (like a `<div>`, `<article>`, or `<section>`) on any webpage and instantly save it as a high-quality PDF file.

The PDF is produced by Chrome's own print engine, so it is paginated like a real document: text is never cut through a line, headings stay with their content, and text stays selectable with clickable links.

---

## ✨ Features

* 🎯 **Interactive Element Picker**: Hover over page elements with real-time visual highlighting to choose the exact content you want.
* 💾 **Direct Download**: Downloads the `.pdf` file directly, without going through the print dialog.
* 📄 **Proper Pagination**: Page breaks fall between lines and paragraphs (no lone first/last lines), headings stay with the content that follows them, images, table rows and small boxes (cards, callouts, banners) are never split, and table headers repeat on every page.
* 🔤 **Real Text**: The PDF contains vector text you can select, search and copy, with working links, instead of a screenshot.
* ⌨️ **Keyboard Refinement**: `↑` / `↓` walk to the parent/child element, `Enter` exports, `Esc` cancels.
* ⚙️ **Page Options**: Choose page size (A4, Letter, Legal, A3), orientation (auto/portrait/landscape) and margins. Settings are remembered.
* 🔑 **Shortcut**: `Alt+Shift+P` opens the popup (customizable at `chrome://extensions/shortcuts`).
* 🎨 **Faithful Rendering**: Everything Chrome can display prints correctly, including web fonts, SVG, canvas, cross-origin images and modern CSS colors.
* 🔒 **Manifest V3 Compliant**: No remote code, no bundled libraries.

---

## 📁 Directory Structure

```text
chrome-html-to-pdf-exporter/
├── manifest.json          # Chrome extension configuration (Manifest V3)
├── popup.html             # Extension popup UI
├── popup.js               # Popup options, script injection & messaging
├── content.js             # Element picker & print layout
└── background.js          # Service worker that prints the tab to PDF
```

---

## 🚀 Installation Guide

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the project folder.

---

## 📖 How to Use

1. Navigate to any webpage.
2. Click the extension icon in the Chrome toolbar (or press `Alt+Shift+P`) to open the popup.
3. Optionally adjust the page size, orientation and margin.
4. Click the **Select Element** button.
5. Move your cursor over the webpage — elements are highlighted with a blue box and a label showing the tag and size.
6. Click the element you wish to export (or use `↑` / `↓` to adjust the selection and press `Enter`).
7. The PDF is generated and downloaded to your default Downloads folder.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `↑` | Select the parent element |
| `↓` | Go back to the child element |
| `Enter` | Export the highlighted element |
| `Esc` | Cancel selection |

---

## 🛠️ How It Works Under the Hood

1. **Injection**: When you click **Select Element**, `popup.js` injects `content.js` into the active tab using the `activeTab` permission.
2. **Selection Mode**: `content.js` draws a highlight overlay (the page's own styles are never modified) and temporarily captures mouse and keyboard events.
3. **Print Layout**: On export, `content.js` marks the selected element and its ancestors and adds a print-only stylesheet that hides everything else, lets the element flow across pages, and adds pagination hints (`break-after: avoid` on headings, `break-inside: avoid` on images, rows and small boxes, `orphans`/`widows` on paragraphs). The page looks the same on screen, and everything is removed once the export finishes.
4. **PDF Generation**: `background.js` briefly attaches to the tab with the `chrome.debugger` API and calls the DevTools Protocol's `Page.printToPDF`, the same engine as Chrome's "Save as PDF". The PDF data goes back to `content.js`, which downloads it.

### 🔐 About the `debugger` permission

`Page.printToPDF` is only available through the `chrome.debugger` API, so Chrome shows an install warning for it. While a PDF is being generated (about a second), Chrome also shows a *"… started debugging this browser"* bar. The extension only uses the debugger to print the tab you are exporting from.

If the debugger can't attach (for example, another extension is already debugging the tab), the extension opens Chrome's print dialog instead, with the same layout. Choose **Save as PDF** there.

### ⚠️ Limitations

* The PDF uses the page's **print** styles. Most sites print well, but a site whose print CSS hides some content will also hide it in the PDF.
* Images loaded by custom JavaScript lazy-loaders that haven't been scrolled into view may be missing; scroll through the content once before exporting.
* Content inside iframes, and siblings of the selected element inside a web component's shadow DOM, are not isolated.
* Browser pages such as `chrome://` URLs and the Chrome Web Store cannot be exported.

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
