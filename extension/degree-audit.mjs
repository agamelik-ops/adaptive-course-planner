export async function importDegreeAudit(tab) {
  if (!tab?.id || !tab.url) throw new Error("Open your Degree Works audit first.");

  const url = new URL(tab.url);

  if (url.protocol !== "https:" || url.hostname !== "degreeworks.fandm.edu") {
    throw new Error("Open your F&M Degree Works audit, then click Import requirements.");
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function classify(label) {
          const text = label.trim().toLowerCase();

          if (text === "requirement is complete") {
            return "complete";
          }

          if (
            text ===
            "when the in-progress classes are completed this requirement should be complete"
          ) {
            return "in-progress";
          }

          if (text === "not complete") {
            return "incomplete";
          }

          return "unknown";
        }

        const requirements = [];
        const seen = new Set();

        for (const icon of document.querySelectorAll("svg[aria-label]")) {
          const statusLabel = icon.getAttribute("aria-label") || "";

          // Ignore icons unrelated to requirement status.
          if (!/requirement|not complete/i.test(statusLabel)) continue;

          const summary = icon.closest(".MuiAccordionSummary-root");
          const row = icon.closest("tr");
          const container = summary || row;

          if (!container) continue;

          const nameElement = summary
            ? summary.querySelector(".MuiAccordionSummary-content p")
            : row.querySelector('th[scope="row"] p');

          const name = nameElement?.textContent?.trim();
          if (!name) continue;

          const status = classify(statusLabel);
          const key = `${name}|${status}`;

          if (seen.has(key)) continue;
          seen.add(key);

          requirements.push({ name, status });
        }

        if (requirements.length === 0) {
          alert(
            "No supported requirements found. Open your Degree Works audit and expand the relevant sections, then try again."
          );
          return null;
        }

        const preview = requirements
          .map(({ name, status }) => `${status}: ${name}`)
          .join("\n");

        const approved = confirm(
          `Import these ${requirements.length} requirements?\n\n` +
          preview +
          "\n\nOnly requirement names and statuses will be saved locally. " +
          "This may be a partial audit."
        );

        if (!approved) return null;

        return {
          version: 1,
          checkedAt: new Date().toISOString(),
          source: "Degree Works displayed audit",
          partial: true,
          requirements
        };
      }
    });

    const audit = results[0]?.result;
    if (!audit) return false;

    await chrome.storage.local.set({ degreeAudit: audit });

    await chrome.tabs.create({
      url: "http://localhost:3000/"
    });
    return true;
  } catch (error) {
    throw new Error(`Degree Works import failed: ${error instanceof Error ? error.message : "Please try again."}`);
  }
}
