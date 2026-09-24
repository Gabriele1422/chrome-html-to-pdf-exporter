// Prints a tab to PDF with Chrome's own print engine (DevTools Protocol
// Page.printToPDF). content.js must already have applied the print layout
// that shows only the selected element. Shared by background.js and preview.js.

const PAPER_SIZES_IN = {
  a4: [8.27, 11.69],
  a3: [11.69, 16.54],
  letter: [8.5, 11],
  legal: [8.5, 14],
};
const MM_PER_INCH = 25.4;

// Returns the PDF as a base64 string.
export async function printTabToPdf(tabId, { format = "a4", landscape = false, margin = 10 }) {
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
