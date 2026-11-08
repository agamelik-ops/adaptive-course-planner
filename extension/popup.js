import { connectionView } from "./connection-status.mjs";

const status = document.getElementById("status");
const start = document.getElementById("sync");
const stop = document.getElementById("cancel");
const autoKey = "fm-availability-auto";
const jobKey = "fm-availability-sync";
async function render() {
  const saved = await chrome.storage.local.get([autoKey, jobKey]);
  const auto = saved[autoKey];
  const job = saved[jobKey];
  const view = connectionView(auto, job);
  const pill = document.getElementById("connection");
  pill.textContent = view.label;
  pill.className = `connection-pill ${view.state}`;
  document.getElementById("last-sync").textContent = view.lastSync
    ? `Last synced ${new Date(view.lastSync).toLocaleString()}${view.total ? ` · ${view.total} sections` : ""}`
    : "No successful sync yet";
  start.hidden = view.connected;
  start.disabled = view.active;
  start.textContent = view.active ? "Connecting…" : auto ? "Reconnect to F&M" : "Connect to F&M";
  stop.hidden = !auto?.enabled;
  status.textContent = view.message;
}
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void render(); });
void render();
// The popup is short-lived; update stale/paused state while it remains open.
setInterval(() => void render(), 15000);
start.addEventListener("click", async () => {
  start.disabled = true;
  try {
    // Request only F&M registration access, directly from this button gesture.
    const granted = await chrome.permissions.request({ origins: ["https://prd-reg9.fandm.edu/*"] });
    if (!granted) throw new Error("Connection cancelled. F&M site access is needed to import availability automatically.");
    const response = await chrome.runtime.sendMessage({ type: "connect-fm" });
    if (response?.error) throw new Error(response.error);
    await render();
  } catch (error) { status.textContent = error.message || "Could not start updates."; start.disabled = false; }
});
stop.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "stop-auto" });
  if (response?.error) status.textContent = response.error;
});
document.getElementById("open").addEventListener("click", () => chrome.tabs.create({ url: "http://localhost:3000/" }));

const auditButton = document.getElementById("audit");
auditButton.addEventListener("click", async () => {
  auditButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Open your Degree Works audit first.");
    // The background worker does the import so it survives this popup closing.
    const response = await chrome.runtime.sendMessage({ type: "import-audit", tabId: tab.id });
    if (response?.error) throw new Error(response.error);
    status.textContent = response?.imported ? "Degree Works requirements imported locally." : "No requirements imported. You can try again from your expanded Degree Works audit.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not import requirements.";
  } finally { auditButton.disabled = false; }
});
