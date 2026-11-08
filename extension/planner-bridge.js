// Runs only on the local planner, never on account/login pages.
(() => {
  const availabilityKey = "fm-availability:spring-2027:v1";
  const autoKey = "fm-availability-auto";
  const auditKey = "degreeAudit";

  function deliver(key, value, eventName, validate) {
    try {
      if (value == null || !validate(value)) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }

      window.dispatchEvent(new Event(eventName));
    } catch (error) {
      console.error(`Could not deliver ${key} to planner:`, error);
    }
  }

  const handlers = {
    [availabilityKey]: (value) =>
      deliver(
        availabilityKey,
        value,
        "fm-availability-change",
        (snapshot) =>
          snapshot.version === 1 &&
          snapshot.term === "202620" &&
          Array.isArray(snapshot.records)
      ),

    [autoKey]: (value) =>
      deliver(
        autoKey,
        value,
        "fm-availability-change",
        (state) =>
          typeof state === "object" &&
          typeof state.enabled === "boolean"
      ),

    [auditKey]: (value) =>
      deliver(
        auditKey,
        value,
        "fm-degree-audit-change",
        (audit) =>
          audit.version === 1 &&
          Array.isArray(audit.requirements) &&
          audit.requirements.every(
            (requirement) =>
              requirement &&
              typeof requirement.name === "string" &&
              ["complete", "in-progress", "incomplete", "unknown"].includes(
                requirement.status
              )
          )
      )
  };

  // Subscribe first so updates during startup are not missed.
  let revision = 0;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    revision++;

    for (const [key, handler] of Object.entries(handlers)) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        handler(changes[key].newValue);
      }
    }
  });

  async function loadSavedData() {
    const startRevision = revision;
    const saved = await chrome.storage.local.get(Object.keys(handlers));

    // Read again if storage changed while loading.
    if (startRevision !== revision) {
      return loadSavedData();
    }

    for (const [key, handler] of Object.entries(handlers)) {
      handler(saved[key]);
    }
  }

  loadSavedData().catch((error) => {
    console.error("Could not load planner imports:", error);
  });
})();