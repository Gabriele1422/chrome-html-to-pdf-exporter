// Prints the requesting tab to PDF with Chrome's own print engine (DevTools
// Protocol Page.printToPDF). content.js has already applied a print stylesheet
// that shows only the selected element.

const PAPER_SIZES_IN = {
  a4: [8.27, 11.69],
  a3: [11.69, 16.54],
  letter: [8.5, 11],
  legal: [8.5, 14],
};
const MM_PER_INCH = 25.4;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "PRINT_TO_PDF" || !sender.tab?.id) return;
  printTabToPdf(sender.tab.id, request.options || {}).then(
    (data) => sendResponse({ data }),
    (err) => sendResponse({ error: err?.message || String(err) }),
  );
  return true; // Respond asynchronously.
});

async function printTabToPdf(tabId, { format = "a4", landscape = false, margin = 10 }) {
  const [width, height] = PAPER_SIZES_IN[format] || PAPER_SIZES_IN.a4;
  const marginIn = margin / MM_PER_INCH;
  const target = { tabId };

  await chrome.debugger.attach(target, "1.3");
  try {
    const { data } = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
      landscape,
      printBackground: true,
      paperWidth: width,
      paperHeight: height,
      marginTop: marginIn,
      marginBottom: marginIn,
      marginLeft: marginIn,
      marginRight: marginIn,
    });
    return data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}
