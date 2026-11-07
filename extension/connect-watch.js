// Installed only in the dedicated F&M tab after the student grants site access.
(() => {
  if (window.fmConnectionWatcher) return;
  window.fmConnectionWatcher = true;
  let notified = false;
  const check = () => {
    const term = document.querySelector("#searchTerms")?.textContent || document.querySelector("#search")?.textContent || "";
    const ready = /Term:\s*Spring 2027/.test(term) && (document.querySelector("#search-go") || document.querySelector("#searchResultsTable"));
    if (ready && !notified) {
      notified = true;
      chrome.runtime.sendMessage({ type: "connection-ready" }).catch(() => { notified = false; });
    }
  };
  new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  check();
})();
