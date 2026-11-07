// Runs only on the local planner, never on account/login pages.
(() => {
  const key = "fm-availability:spring-2027:v1";
  const deliver = (snapshot) => {
    if (!snapshot || snapshot.version !== 1 || snapshot.term !== "202620" || !Array.isArray(snapshot.records)) return;
    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
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
  chrome.storage.local.get([key, autoKey]).then((saved) => { deliver(saved[key]); deliverAuto(saved[autoKey]); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[key]) deliver(changes[key].newValue);
    if (area === "local" && changes[autoKey]) deliverAuto(changes[autoKey].newValue);
  });
})();
