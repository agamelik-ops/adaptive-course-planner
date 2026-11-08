import { importDegreeAudit } from "./degree-audit.mjs";
import { syncAllAvailability } from "./full-sync.mjs";

const autoKey = "fm-availability-auto";
const jobKey = "fm-availability-sync";
const alarmName = "fm-refresh-availability";
const interval = 5 * 60 * 1000;
const catalogInterval = 30 * 60 * 1000;
const planKey = "fm-availability-plan:202620";
let planPending = false;
let busy = false;
let generation = 0;

async function pause(message) {
  generation++;
  await chrome.alarms.clear(alarmName);
  const saved = (await chrome.storage.local.get(autoKey))[autoKey];
  await chrome.storage.local.set({ [autoKey]: { ...saved, enabled: false, state: "paused", message, updatedAt: Date.now() } });
  const job = (await chrome.storage.local.get(jobKey))[jobKey];
  if (job?.state === "running") await chrome.storage.local.set({ [jobKey]: { ...job, cancel: true } });
}

async function refresh() {
  if (busy) return;
  busy = true;
  const runGeneration = generation;
  try {
    const config = (await chrome.storage.local.get(autoKey))[autoKey];
    if (!config?.enabled) return;
    const tab = await chrome.tabs.get(config.tabId);
    const url = new URL(tab.url || "about:blank");
    if (url.origin !== "https://prd-reg9.fandm.edu" || url.pathname !== "/StudentRegistrationSsb/ssb/classSearch/classSearch") throw new Error("Updates paused. Open Browse Classes and start automatic updates again.");
    if (runGeneration !== generation) return;
    await chrome.storage.local.set({ [autoKey]: { ...config, state: "syncing", message: "Refreshing Spring 2027 availability…", updatedAt: Date.now(), nextCheckAt: null } });
    if (runGeneration !== generation) return;
    const plan = (await chrome.storage.local.get(planKey))[planKey] || [];
    const numbers = [...new Set(plan.map(row => row.number).filter(value => /^\d{3}[A-Z]?$/i.test(value)))];
    const fullDue = !config.lastCatalogAt || Date.now() - config.lastCatalogAt >= catalogInterval;
    // Prioritize the plan on the first connection too. A full scan is much less frequent.
    const queries = [...numbers.map(number => ({ number })), ...(fullDue ? [{}] : [])];
    for (const query of queries) {
      if (runGeneration !== generation) return;
      await chrome.scripting.executeScript({ target: { tabId: config.tabId }, func: syncAllAvailability, args: [query] });
      const job = (await chrome.storage.local.get(jobKey))[jobKey];
      if (job?.state !== "complete") throw new Error(job?.message || "Updates paused. The registration session may have expired.");
    }
    const current = (await chrome.storage.local.get(autoKey))[autoKey];
    if (!current?.enabled || runGeneration !== generation) return;
    const job = (await chrome.storage.local.get(jobKey))[jobKey];
    if (job?.state !== "complete") throw new Error(job?.message || "Updates paused. The registration session may have expired.");
    const lastCatalogAt = fullDue ? Date.now() : config.lastCatalogAt;
    const nextCheckAt = Math.min(Date.now() + (numbers.length ? interval : catalogInterval), lastCatalogAt + catalogInterval);
    await chrome.storage.local.set({ [autoKey]: { ...current, state: "waiting", lastSuccessfulAt: queries.length ? Date.now() : current.lastSuccessfulAt, lastCatalogAt, message: "Automatic updates on · Plan every 5 minutes · Catalog every 30 minutes", updatedAt: Date.now(), nextCheckAt } });
    await chrome.alarms.create(alarmName, { when: nextCheckAt });
  } catch (error) {
    if (runGeneration !== generation) return;
    await pause(error instanceof Error ? error.message : "Updates paused. Reconnect Browse Classes.");
  } finally {
    busy = false;
    if (planPending) { planPending = false; void refresh(); }
  }
}

async function watchConnection(tabId) {
  const config = (await chrome.storage.local.get(autoKey))[autoKey];
  if (!config?.enabled || config.state !== "connecting" || config.tabId !== tabId) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith("https://prd-reg9.fandm.edu/")) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["connect-watch.js"] });
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !["connect-fm", "connection-ready", "stop-auto"].includes(message?.type)) return;
  (async () => {
    if (message.type === "stop-auto") {
      await pause("Disconnected. Saved availability remains visible.");
    } else if (message.type === "connection-ready") {
      const config = (await chrome.storage.local.get(autoKey))[autoKey];
      if (config?.enabled && config.state === "connecting" && sender.tab?.id === config.tabId) void refresh();
    } else {
      if (busy) throw new Error("A refresh is already running.");
      if (!await chrome.permissions.contains({ origins: ["https://prd-reg9.fandm.edu/*"] })) throw new Error("F&M site access is needed to connect.");
      await chrome.alarms.clear(alarmName);
      const tab = await chrome.tabs.create({ url: "https://prd-reg9.fandm.edu/StudentRegistrationSsb/ssb/classSearch/classSearch", active: true });
      await chrome.storage.local.set({ [autoKey]: { enabled: true, tabId: tab.id, state: "connecting", message: "Connecting to F&M. Sign in and select Spring 2027 if prompted; import starts automatically afterward.", updatedAt: Date.now() } });
      // The load event may occur before the config is stored on fast pages.
      if ((await chrome.tabs.get(tab.id)).status === "complete") await watchConnection(tab.id);
    }
    respond({ ok: true });
  })().catch((error) => respond({ error: error.message }));
  return true;
});
// The plan persists across popup/tab closure. Changes queue one follow-up pass,
// never another concurrent scan, and removals stop future targeted searches.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[planKey]) return;
  if (busy) planPending = true;
  else {
    const config = (await chrome.storage.local.get(autoKey))[autoKey];
    if (config?.enabled && config.state !== "connecting") await chrome.alarms.create(alarmName, { when: Date.now() + 1000 });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === alarmName) void refresh(); });
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const config = (await chrome.storage.local.get(autoKey))[autoKey];
  if (config?.enabled && config.tabId === tabId) await pause("Updates paused: the registration tab was closed.");
});
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  const config = (await chrome.storage.local.get(autoKey))[autoKey];
  if (!config?.enabled || config.tabId !== tabId) return;
  if (config.state === "connecting") {
    if (change.status === "complete") {
      try { await watchConnection(tabId); }
      catch { await pause("Could not connect. Click Connect to F&M to try again."); }
    }
    return; // Sign-in redirects are expected while connecting.
  }
  if (change.url && !change.url.startsWith("https://prd-reg9.fandm.edu/StudentRegistrationSsb/ssb/classSearch/classSearch")) await pause("Updates paused: the registration tab navigated away. Reconnect to continue.");
});
chrome.runtime.onStartup.addListener(() => { void pause("Updates paused after browser restart. Reconnect Browse Classes."); });
chrome.runtime.onInstalled.addListener(() => { void pause("Click Connect to F&M to start automatic availability updates."); });

// Keep the approved import alive if the extension popup loses focus.
let auditImportBusy = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "import-degree-works") return;
  (async () => {
    if (auditImportBusy) throw new Error("A Degree Works import is already in progress.");
    auditImportBusy = true;
    try {
      await chrome.storage.local.set({ degreeAuditImport: { state: "importing", updatedAt: Date.now(), message: "Reading Degree Works. Review the preview in that tab." } });
      const result = await importDegreeAudit(await chrome.tabs.get(message.tabId));
      await chrome.storage.local.set({ degreeAuditImport: { state: result ? "complete" : "cancelled", updatedAt: Date.now(), message: result ? "Degree Works updated. Your planner can use the saved audit." : "Import cancelled. Your previous saved audit is unchanged." } });
      respond({ result });
    } catch (error) {
      const message = error.message || "Degree Works import failed.";
      await chrome.storage.local.set({ degreeAuditImport: { state: "error", updatedAt: Date.now(), message } });
      respond({ error: message });
    } finally { auditImportBusy = false; }
  })().catch((error) => respond({ error: error.message }));
  return true;
});
