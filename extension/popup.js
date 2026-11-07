const status = document.getElementById("status");
const start = document.getElementById("sync");
const stop = document.getElementById("cancel");
const autoKey = "fm-availability-auto";
const jobKey = "fm-availability-sync";
async function render() {
  const saved = await chrome.storage.local.get([autoKey, jobKey]);
  const auto = saved[autoKey];
  const job = saved[jobKey];
  start.disabled = !!auto?.enabled;
  stop.hidden = !auto?.enabled;
  status.textContent = auto?.state === "syncing" && job?.state === "running" ? job.message : auto?.message || "Only CRNs and seat status are stored locally. No account details are collected.";
}
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void render(); });
void render();
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
