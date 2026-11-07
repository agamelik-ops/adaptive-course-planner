import { syncAllAvailability } from "./full-sync.mjs";

const autoKey = "fm-availability-auto";
const jobKey = "fm-availability-sync";
const alarmName = "fm-refresh-availability";
const interval = 5 * 60 * 1000;
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
    await chrome.storage.local.set({ [autoKey]: { ...config, state: "syncing", message: "Refreshing all Spring 2027 sections…", updatedAt: Date.now(), nextCheckAt: null } });
    if (runGeneration !== generation) return;
    await chrome.scripting.executeScript({ target: { tabId: config.tabId }, func: syncAllAvailability });
    const current = (await chrome.storage.local.get(autoKey))[autoKey];
    if (!current?.enabled || runGeneration !== generation) return;
    const job = (await chrome.storage.local.get(jobKey))[jobKey];
    if (job?.state !== "complete") throw new Error(job?.message || "Updates paused. The registration session may have expired.");
    const nextCheckAt = Date.now() + interval;
    await chrome.storage.local.set({ [autoKey]: { ...current, state: "waiting", lastSuccessfulAt: Date.now(), message: "Automatic updates on · Every 5 minutes", updatedAt: Date.now(), nextCheckAt } });
    await chrome.alarms.create(alarmName, { when: nextCheckAt });
  } catch (error) {
    if (runGeneration !== generation) return;
    await pause(error instanceof Error ? error.message : "Updates paused. Reconnect Browse Classes.");
  } finally { busy = false; }
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
