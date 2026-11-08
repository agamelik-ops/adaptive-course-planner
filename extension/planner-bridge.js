// Runs only on the local planner, never on account/login pages.
(() => {
  const key = "fm-availability:spring-2027:v1";
  const checksKey = "fm-availability-checks:202620";
  let snapshot, checks = {};
  const deliver = (value) => {
    if (value) snapshot = value;
    if (!snapshot || snapshot.version !== 1 || snapshot.term !== "202620" || !Array.isArray(snapshot.records)) return;
    try {
      localStorage.setItem(key, JSON.stringify({ ...snapshot, records: snapshot.records.map(row => ({ ...row, checkedAt: checks[row.crn] || row.checkedAt })) }));
      window.dispatchEvent(new Event("fm-availability-change"));
    } catch { /* The planner will continue to show availability as unknown. */ }
  };
  const autoKey = "fm-availability-auto";
  const deliverAuto = (state) => {
    try {
      localStorage.setItem(autoKey, JSON.stringify(state ?? null));
      window.dispatchEvent(new Event("fm-availability-change"));
    } catch { /* Storage unavailable. */ }
  };
  chrome.storage.local.get([key, autoKey, checksKey]).then((saved) => { checks = saved[checksKey] || {}; deliver(saved[key]); deliverAuto(saved[autoKey]); });
  const planKey = "fm-availability-plan:202620";
  const sendPlan = async () => {
    try {
      const raw = JSON.parse(localStorage.getItem(planKey) || "null");
      if (!Array.isArray(raw) || raw.length > 100) return;
      const plan = raw.filter(row => /^\d{5}$/.test(row?.crn) && /^\d{3}[A-Z]?$/i.test(row?.number));
      const saved = (await chrome.storage.local.get(planKey))[planKey];
      if (JSON.stringify(saved) !== JSON.stringify(plan)) await chrome.storage.local.set({ [planKey]: plan });
    } catch { /* Keep the existing plan when storage is unavailable. */ }
  };
  window.addEventListener("fm-availability-plan-change", sendPlan);
  window.addEventListener("storage", event => { if (event.key === planKey) void sendPlan(); });
  void sendPlan();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[checksKey]) checks = changes[checksKey].newValue || {};
    // Publish status and timestamps together, once per storage transaction.
    if (changes[key] || changes[checksKey]) deliver(changes[key]?.newValue);
    if (changes[autoKey]) deliverAuto(changes[autoKey].newValue);
  });
})();
