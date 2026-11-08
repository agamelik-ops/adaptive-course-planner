// Runs on the planner page and hands it the Degree Works audit that
// background.js saved in chrome.storage.local (the page can't read that storage itself).

function sendAudit() {
  chrome.storage.local.get("degreeAudit").then(({ degreeAudit }) => {
    if (!degreeAudit) return;
    window.postMessage(
      { source: "fm-planner-extension", type: "degree-audit", audit: degreeAudit },
      window.location.origin
    );
  });
}

// The page asks for the audit once it's ready to listen.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source === "fm-planner-page" && event.data.type === "request-degree-audit") {
    sendAudit();
  }
});

// Re-send whenever a fresh import happens while the planner is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.degreeAudit) sendAudit();
});

sendAudit();
