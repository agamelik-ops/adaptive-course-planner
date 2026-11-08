// Runs only on the local planner, never on account/login pages.
// Runs only on the local planner, never on account/login pages.
(() => {
  const key = "fm-availability:spring-2027:v1";
  const checksKey = "fm-availability-checks:202620";
  const autoKey = "fm-availability-auto";
  const planKey = "fm-availability-plan:202620";
  const auditKey = "degreeAudit";

  let snapshot = null;
  let checks = {};
  let revision = 0;

  function deliverAvailability() {
    try {
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        snapshot.term !== "202620" ||
        !Array.isArray(snapshot.records)
      ) {
        localStorage.removeItem(key);
      } else {
        const records = snapshot.records.map((row) => ({
          ...row,
          checkedAt: checks[row.crn] || row.checkedAt
        }));

        localStorage.setItem(
          key,
          JSON.stringify({ ...snapshot, records })
        );
      }

      window.dispatchEvent(new Event("fm-availability-change"));
    } catch {
      // The planner remains usable when storage is unavailable.
    }
  }

  function deliverAuto(state) {
    try {
      if (state == null) {
        localStorage.removeItem(autoKey);
      } else {
        localStorage.setItem(autoKey, JSON.stringify(state));
      }

      window.dispatchEvent(new Event("fm-availability-change"));
    } catch {
      // Storage unavailable.
    }
  }

  function deliverAudit(audit) {
    try {
      const valid =
        audit?.version === 1 &&
        Array.isArray(audit.requirements) &&
        audit.requirements.every(
          (requirement) =>
            requirement &&
            typeof requirement.name === "string" &&
            [
              "complete",
              "in-progress",
              "incomplete",
              "unknown"
            ].includes(requirement.status)
        );

      if (valid) {
        localStorage.setItem(auditKey, JSON.stringify(audit));
      } else {
        localStorage.removeItem(auditKey);
      }

      window.dispatchEvent(new Event("fm-degree-audit-change"));
    } catch {
      // Storage unavailable.
    }
  }

  // Transfer only planned course identifiers to the extension.
  // Degree Works data is not included in this message.
  let sendingPlan = false;
  let planPending = false;

  async function sendPlan() {
    planPending = true;

    if (sendingPlan) return;
    sendingPlan = true;

    try {
      while (planPending) {
        planPending = false;

        const raw = JSON.parse(
          localStorage.getItem(planKey) || "null"
        );

        if (!Array.isArray(raw) || raw.length > 100) continue;

        const plan = raw
          .filter(
            (row) =>
              row &&
              typeof row.crn === "string" &&
              typeof row.number === "string" &&
              /^\d{5}$/.test(row.crn) &&
              /^\d{3}[A-Z]?$/i.test(row.number)
          )
          .map((row) => ({
            crn: row.crn,
            number: row.number
          }));

        const saved = (
          await chrome.storage.local.get(planKey)
        )[planKey];

        if (JSON.stringify(saved) !== JSON.stringify(plan)) {
          await chrome.storage.local.set({
            [planKey]: plan
          });
        }
      }
    } catch {
      // Keep the existing extension plan if storage is unavailable.
    } finally {
      sendingPlan = false;
    }
  }

  window.addEventListener(
    "fm-availability-plan-change",
    () => void sendPlan()
  );

  window.addEventListener("storage", (event) => {
    if (event.key === planKey || event.key === null) {
      void sendPlan();
    }
  });

  // Subscribe before the initial read to avoid missing updates.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    const has = (name) =>
      Object.prototype.hasOwnProperty.call(changes, name);

    if (
      has(key) ||
      has(checksKey) ||
      has(autoKey) ||
      has(auditKey)
    ) {
      revision++;
    }

    if (has(key)) {
      snapshot = changes[key].newValue ?? null;
    }

    if (has(checksKey)) {
      checks = changes[checksKey].newValue || {};
    }

    // Publish availability and check timestamps together.
    if (has(key) || has(checksKey)) {
      deliverAvailability();
    }

    if (has(autoKey)) {
      deliverAuto(changes[autoKey].newValue);
    }

    if (has(auditKey)) {
      deliverAudit(changes[auditKey].newValue);
    }
  });

  async function loadSavedData() {
    while (true) {
      const startRevision = revision;

      const saved = await chrome.storage.local.get([
        key,
        checksKey,
        autoKey,
        auditKey
      ]);

      // Retry if newer data arrived during the read.
      if (startRevision !== revision) continue;

      snapshot = saved[key] ?? null;
      checks = saved[checksKey] || {};

      deliverAvailability();
      deliverAuto(saved[autoKey]);
      deliverAudit(saved[auditKey]);
      return;
    }
  }

  void loadSavedData().catch((error) => {
    console.error("Could not load planner imports:", error);
  });

  void sendPlan();
})();