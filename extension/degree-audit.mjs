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

        // Only the class level and expected graduation are read from the student header;
        // name, ID, GPA and anything else on the page are ignored.
        // Gather page text from every place Degree Works might render the header:
        // visible text, raw text (label and value can be glued together), same-origin
        // frames and web-component shadow roots.
        function collectText() {
          const parts = [];
          const visit = (root) => {
            if (!root) return;
            const body = root.body || root;
            parts.push(body.innerText || "", body.textContent || "");
            for (const element of (root.querySelectorAll ? root.querySelectorAll("*") : [])) {
              if (element.shadowRoot) visit(element.shadowRoot);
              if (element.tagName === "IFRAME") {
                try { visit(element.contentDocument); } catch { /* cross-origin frame */ }
              }
            }
          };
          visit(document);
          return parts.join("\n").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "");
        }

        function findStudentInfo() {
          const text = collectText();
          const levels = { freshman: "FR", "first-year": "FR", "first year": "FR", firstyear: "FR", sophomore: "SO", junior: "JR", senior: "SR" };
          // No word-boundary or space requirements: raw text can glue labels and values together.
          const levelMatch = text.match(/(?:classification|class\s*level|class|level)\s*:?\s*(freshman|first[-\s]?year|sophomore|junior|senior)/i);
          const gradMatch = text.match(/(?:expected|anticipated|projected)\s*grad(?:uation)?\s*(?:date|term|year)?\s*:?\s*((?:spring|summer|fall|winter|january|may|august|december)?\s*(?:19|20)\d{2})(?!\d)/i);
          const info = {};
          if (levelMatch) {
            info.classLevel = levels[levelMatch[1].toLowerCase().replace(/\s+/g, " ")] || levels[levelMatch[1].toLowerCase().replace(/[-\s]/g, "")];
            info.classLevelLabel = levelMatch[1].trim();
          }
          if (gradMatch) info.expectedGraduation = gradMatch[1].replace(/\s+/g, " ").trim();
          return info.classLevel || info.expectedGraduation ? info : null;
        }
        const student = findStudentInfo();

        if (requirements.length === 0) {
          alert(
            "No supported requirements found. Open your Degree Works audit and expand the relevant sections, then try again."
          );
          return null;
        }

        const preview = requirements
          .map(({ name, status }) => `${status}: ${name}`)
          .join("\n");

        const studentPreview = student
          ? "\n\nStudent info:" +
            (student.classLevelLabel ? `\nClass level: ${student.classLevelLabel}` : "") +
            (student.expectedGraduation ? `\nExpected graduation: ${student.expectedGraduation}` : "")
          : "\n\nStudent info: not found on this page (the planner will ask your class year).";

        const approved = confirm(
          `Import these ${requirements.length} requirements?\n\n` +
          preview +
          studentPreview +
          "\n\nOnly requirement names and statuses" +
          (student ? ", your class level and expected graduation" : "") +
          " will be saved locally. This may be a partial audit."
        );

        if (!approved) return null;

        return {
          version: 1,
          checkedAt: new Date().toISOString(),
          source: "Degree Works displayed audit",
          partial: true,
          requirements,
          ...(student ? { student } : {})
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
