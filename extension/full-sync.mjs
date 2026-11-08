// Runs in the registration tab's isolated extension world. It continues if the
// popup closes; progress and cancellation live in extension-local storage.
export async function syncAllAvailability(options = {}) {
  if (globalThis.fmAvailabilityScan) return;
  const key = "fm-availability:spring-2027:v1";
  const jobKey = "fm-availability-sync";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const id = `${Date.now()}-${Math.random()}`;
  const collected = new Map();
  let total = 0;
  const checksKey = "fm-availability-checks:202620";
  const number = options.number;
  if (number !== undefined && !/^\d{3}[A-Z]?$/i.test(number)) throw new Error("Invalid course number.");
  let cancel = false;
  let started = false;
  const isVisible = (el) => !!el && el.getClientRects().length > 0;
  const oldJob = (await chrome.storage.local.get(jobKey))[jobKey];
  if (oldJob?.state === "running" && !oldJob.cancel && Date.now() - oldJob.updatedAt < 60000) return;
  if (globalThis.fmAvailabilityScan) return;
  globalThis.fmAvailabilityScan = true;
  const onChange = (changes, area) => {
    if (area === "local" && changes[jobKey]?.newValue?.id === id && changes[jobKey].newValue.cancel) cancel = true;
  };
  chrome.storage.onChanged.addListener(onChange);
  const progress = async (state, message) => {
    await chrome.storage.local.set({ [jobKey]: { id, state, message, total, scanned: collected.size, updatedAt: Date.now(), cancel } });
  };
  const check = () => { if (cancel) throw new Error("Sync cancelled. Your previous saved availability is unchanged."); };
  const waitFor = async (predicate) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      check();
      if (predicate()) return;
      await delay(200);
    }
    throw new Error("The registration page stopped responding. Keep Browse Classes open and retry the sync.");
  };
  const readPage = () => {
    const term = document.querySelector("#searchTerms")?.textContent.replace(/\s+/g, " ").trim();
    if (number ? !term?.startsWith("Term: Spring 2027") : term !== "Term: Spring 2027") throw new Error("Full sync requires Spring 2027 with no search filters.");
    const rows = Array.from(document.querySelectorAll("#searchResultsTable tbody tr"));
    const result = [];
    for (const row of rows) {
      const crn = row.querySelector('td[data-property="courseReferenceNumber"]')?.textContent.trim();
      if (!crn) continue;
      const attrs = row.querySelector("a.section-details-link")?.getAttribute("data-attributes");
      const statusCell = row.querySelector('td[data-property="status"]');
      const status = (statusCell?.getAttribute("title") || statusCell?.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^\d{5}$/.test(crn) || attrs !== `202620,${crn}` || !status || status.length > 1000) throw new Error(`Could not safely read section ${crn}. Sync stopped; try reloading Browse Classes.`);
      if (number && row.querySelector('td[data-property="courseNumber"]')?.textContent.trim() !== number) throw new Error("Course-number filter did not match the results. Refresh stopped.");
      result.push({ crn, status, checkedAt: new Date().toISOString() });
    }
    if (!result.length) throw new Error("No sections could be read from the results table.");
    return result;
  };
  const signature = () => Array.from(document.querySelectorAll('#searchResultsTable td[data-property="courseReferenceNumber"]')).map((el) => el.textContent.trim()).join(",");
  try {
    started = true;
    if (location.origin !== "https://prd-reg9.fandm.edu" || location.pathname !== "/StudentRegistrationSsb/ssb/classSearch/classSearch") throw new Error("Open F&M Browse Classes, select Spring 2027, then sync again.");
    await progress("running", number ? `Checking planned course number ${number}…` : "Preparing full catalog search… Keep Browse Classes open.");
    const saved = (await chrome.storage.local.get(key))[key];
    const previous = saved?.term === "202620" && Array.isArray(saved.records) ? saved.records : [];
    const again = document.querySelector("#search-again-button");
    if (isVisible(again)) again.click();
    await waitFor(() => isVisible(document.querySelector("#search-clear")));
    const searchArea = document.querySelector("#search");
    if (!searchArea?.textContent.includes("Term: Spring 2027")) throw new Error("Select Spring 2027 before syncing.");
    document.querySelector("#search-clear").click();
    await delay(300);
    check();
    if (number) {
      const field = document.querySelector("#txt_courseNumber");
      if (!field) throw new Error("Course-number search is unavailable. Reconnect to F&M.");
      field.value = number;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelector("#search-go").click();
    await waitFor(() => isVisible(document.querySelector("#searchResultsTable")) && !isVisible(document.querySelector("#search-go")) && !!signature());
    readPage(); // Validate term and absence of filters before collecting anything.
    const heading = document.querySelector("#searchResults h3")?.textContent || "";
    total = Number(heading.match(/(\d+)\s+Class(?:es)?/i)?.[1]);
    if (!Number.isInteger(total) || total < 1 || total > 2000) throw new Error("Could not verify the catalog size. Sync stopped without claiming a complete import.");
    const size = document.querySelector("#searchResults select.page-size-select");
    if (size && size.value !== "50" && total > 10 && Array.from(size.options).some((option) => option.value === "50")) {
      size.value = "50";
      size.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => document.querySelectorAll('#searchResultsTable td[data-property="courseReferenceNumber"]').length === Math.min(50, total));
    }
    for (let page = 0; page < 200; page++) {
      check();
      const records = readPage();
      if (records.some((row) => collected.has(row.crn))) throw new Error("A results page repeated during sync. Retry without changing the registration tab.");
      records.forEach((row) => collected.set(row.crn, row));
      await progress("running", `Synced ${collected.size} of ${total} sections… Keep Browse Classes open.`);
      const next = document.querySelector('#searchResults button[title="Next"]');
      if (!next || next.disabled || next.getAttribute("aria-disabled") === "true") break;
      const before = signature();
      await delay(750); // One normal UI page at a time; no parallel requests.
      check();
      next.click();
      await waitFor(() => signature() !== before && !!signature());
    }
    check();
    if (collected.size !== total) throw new Error(`Only ${collected.size} of ${total} sections were read. Previous availability kept; retry to finish.`);
    // Commit only a verified scan. Unchanged status records are not rewritten;
    // small check timestamps live separately from the saved availability data.
    const old = new Map(previous.map(row => [row.crn, row]));
    const merged = number ? new Map(old) : new Map();
    let changed = !number && old.size !== collected.size;
    const checks = (await chrome.storage.local.get(checksKey))[checksKey] || {};
    for (const [crn, row] of collected) {
      const before = old.get(crn);
      const differs = before && before.status !== row.status;
      merged.set(crn, !before || differs ? { ...row, changedAt: differs ? row.checkedAt : null } : before);
      if (!before || differs) changed = true;
      checks[crn] = row.checkedAt;
    }
    check();
    const updates = { [checksKey]: checks };
    if (changed) updates[key] = { version: 1, term: "202620", records: Array.from(merged.values()), changedAt: previous.some(before => !merged.has(before.crn) || merged.get(before.crn).status !== before.status) ? new Date().toISOString() : saved?.changedAt || null };
    await chrome.storage.local.set(updates);
    await progress("complete", `Checked ${total} sections${number ? ` for course number ${number}` : " across the catalog"}. Saved availability is ready.`);
  } catch (error) {
    if (started) await progress(cancel ? "cancelled" : "error", error instanceof Error ? error.message : "Sync failed. Please retry.");
  } finally {
    chrome.storage.onChanged.removeListener(onChange);
    globalThis.fmAvailabilityScan = false;
  }
}
