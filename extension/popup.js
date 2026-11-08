import { connectionView, degreeWorksView } from "./connection-status.mjs";
import { PLANNER_URL } from "./config.mjs";

const status = document.getElementById("status");
const start = document.getElementById("sync");
const stop = document.getElementById("cancel");
const autoKey = "fm-availability-auto";
const jobKey = "fm-availability-sync";
async function render() {
  const saved = await chrome.storage.local.get([autoKey, jobKey, "degreeAudit", "degreeAuditImport", "fm-availability:spring-2027:v1"]);
  const audit = saved.degreeAudit;
  const auditView = degreeWorksView(audit, saved.degreeAuditImport);
  const auditPill = document.getElementById("audit-connection");
  auditPill.textContent = auditView.label;
  auditPill.className = `connection-pill ${auditView.state}`;
  document.getElementById("audit-summary").textContent = auditView.detail;
  document.getElementById("audit-note").textContent = auditView.note;
  document.getElementById("audit").textContent = auditView.button;
  document.getElementById("audit").disabled = auditView.importing;
  document.getElementById("audit-status").textContent = saved.degreeAuditImport?.message || "";
  const auto = saved[autoKey];
  const job = saved[jobKey];
  const view = connectionView(auto, job);
  const pill = document.getElementById("connection");
  pill.textContent = view.label;
  pill.className = `connection-pill ${view.state}`;
  document.getElementById("last-sync").textContent = view.lastSync
    ? `Last checked ${new Date(view.lastSync).toLocaleString()}`
    : "No successful sync yet";
  const changedAt = saved["fm-availability:spring-2027:v1"]?.changedAt;
  document.getElementById("last-changed").textContent = `Last changed: ${changedAt ? new Date(changedAt).toLocaleString() : "No changes observed yet"}`;
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
document.getElementById("open").addEventListener("click", () => chrome.tabs.create({ url: PLANNER_URL }));

const auditButton = document.getElementById("audit");
auditButton.addEventListener("click", async () => {
  auditButton.disabled = true;
  auditButton.textContent = "Importing…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({ type: "import-degree-works", tabId: tab?.id });
    if (response?.error) throw new Error(response.error);
    document.getElementById("audit-status").textContent = response.result ? "Degree Works imported. Your academic history and degree progress are saved." : "Import cancelled. Your saved audit was not changed.";
  } catch (error) {
    document.getElementById("audit-status").textContent = error instanceof Error ? error.message : "Could not import Degree Works.";
  } finally { await render(); }
});
