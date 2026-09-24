const DEFAULT_OPTIONS = { format: "a4", orientation: "auto", margin: 10, preview: true };

const formatEl = document.getElementById("format");
const orientationEl = document.getElementById("orientation");
const marginEl = document.getElementById("margin");
const previewEl = document.getElementById("preview");
const button = document.getElementById("start-select");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(DEFAULT_OPTIONS).then((options) => {
  formatEl.value = options.format;
  orientationEl.value = options.orientation;
  marginEl.value = options.margin;
  previewEl.checked = options.preview;
  // Enabled only now, so a quick click can't read (and save) an unfilled form.
  button.disabled = false;
});

function readOptions() {
  const margin = Number.parseFloat(marginEl.value);
  return {
    format: formatEl.value,
    orientation: orientationEl.value,
    margin: Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_OPTIONS.margin,
    preview: previewEl.checked,
  };
}

button.addEventListener("click", async () => {
  button.disabled = true;
  statusEl.textContent = "";

  const options = readOptions();
  chrome.storage.sync.set(options);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");

    // Inject the picker only on demand, and only if a live copy isn't
    // already listening (a copy left over from before an extension reload is dead).
    const alreadyLoaded = await chrome.tabs.sendMessage(tab.id, { action: "PING" }).catch(() => false);
    if (!alreadyLoaded) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    }

    await chrome.tabs.sendMessage(tab.id, { action: "ENABLE_SELECTION", options });
    window.close();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "This page can't be accessed (e.g. chrome:// pages or the Web Store).";
    button.disabled = false;
  }
});
