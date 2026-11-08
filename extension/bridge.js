// Runs on the planner page and hands it the Degree Works audit that
// background.js saved in chrome.storage.local (the page can't read that storage itself).
//
// When the extension is reloaded or updated, this old copy keeps running in tabs
// that were already open but can no longer use chrome.* ("Extension context
// invalidated"). It then stops quietly; refreshing the tab loads a fresh copy.

function extensionAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function stop() {
  window.removeEventListener("message", onPageMessage);
}

function deliver({ degreeAudit }) {
  if (!degreeAudit) return;
  window.postMessage(
    { source: "fm-planner-extension", type: "degree-audit", audit: degreeAudit },
    window.location.origin
  );
}

function sendAudit() {
  if (!extensionAlive()) return stop();
  try {
    chrome.storage.local.get("degreeAudit").then(deliver, stop);
  } catch {
    stop(); // the extension was reloaded mid-call
  }
}

// The page asks for the audit once it's ready to listen.
function onPageMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source === "fm-planner-page" && event.data.type === "request-degree-audit") {
    sendAudit();
  }
}
window.addEventListener("message", onPageMessage);

// Re-send whenever a fresh import happens while the planner is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.degreeAudit) sendAudit();
});

sendAudit();
