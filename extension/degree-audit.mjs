// Serialized into the signed-in Degree Works page. No network or account fields.
export async function extractDegreeAudit() {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const classify = (label) => {
    if (/in-progress classes/i.test(label)) return "in-progress";
    if (/not complete/i.test(label)) return "incomplete";
    if (/requirement is complete/i.test(label)) return "complete";
    return "unknown";
  };
  const expand = document.querySelector("#expand-all-audit-sections-summary");
  if (expand?.getAttribute("aria-expanded") === "false") expand.click();
  // Wait for expanded tables to settle instead of collecting mid-render.
  let stable = 0, previous = -1;
  for (let attempt = 0; attempt < 30 && stable < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const count = document.querySelectorAll("table tbody tr").length;
    stable = count === previous && count > 0 ? stable + 1 : 0;
    previous = count;
  }
  const profile = {};
  const profileLabels = { Major: "major", Minor: "minor", Concentration: "concentration", "Earned Credits": "earnedCredits", "Language Tests": "languagePlacement", "Math Tests": "mathPlacement", "Anticipated Grad Year": "graduationYear" };
  for (const term of document.querySelectorAll("#student-details dt")) {
    const key = profileLabels[clean(term.textContent)];
    const value = clean(term.parentElement?.querySelector("dd")?.textContent);
    if (key && value) profile[key] = value;
  }
  const degree = clean(document.querySelector("#degree")?.value);
  if (degree) profile.degree = degree;
  const requirements = [], blocks = [], seen = new Set(), courseMap = new Map();
  for (const summary of document.querySelectorAll(".MuiAccordionSummary-root")) {
    const heading = summary.querySelector("h3");
    if (!heading) continue;
    const title = clean(heading.textContent).replace(/\s+(IN-PROGRESS|COMPLETE|NOT COMPLETE)$/, "");
    const catalogYear = clean(summary.textContent).match(/Catalog year:\s*(\d{4}-\d{4})/)?.[1];
    blocks.push({ name: title, ...(catalogYear ? { catalogYear } : {}) });
  }
  for (const icon of document.querySelectorAll("svg[aria-label]")) {
    const label = icon.getAttribute("aria-label") || "";
    if (!/requirement|not complete/i.test(label)) continue;
    const row = icon.closest("tr");
    if (!row) continue;
    const name = clean(row.querySelector('th[scope="row"] p')?.textContent);
    if (!name) continue;
    const status = classify(label);
    const block = clean(row.closest(".MuiAccordion-root")?.querySelector("h3")?.textContent).replace(/\s+(IN-PROGRESS|COMPLETE|NOT COMPLETE)$/, "");
    const id = `${block}|${name}|${status}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const details = clean(row.textContent).slice(0, 4000);
    requirements.push({ name, status, block, details });
  }
  for (const table of document.querySelectorAll("table")) {
    const headers = Array.from(table.querySelectorAll("thead tr:first-child > *")).map((el) => clean(el.textContent).toLowerCase());
    if (!headers.includes("course") || !headers.includes("term")) continue;
    const block = clean(table.closest(".MuiAccordion-root")?.querySelector("h3")?.textContent).replace(/\s+(IN-PROGRESS|COMPLETE|NOT COMPLETE)$/, "");
    for (const row of table.querySelectorAll("tbody tr")) {
      const cells = Array.from(row.children).filter((el) => /^(TD|TH)$/.test(el.tagName));
      // Continuation rows omit the leading requirement cell because of rowspan.
      const offset = headers.length - cells.length;
      const value = (field) => clean(cells[headers.indexOf(field) - offset]?.textContent);
      const code = value("course").replace(/\s+/g, " ").toUpperCase();
      const term = value("term");
      if (!/^[A-Z]{2,5}\s+\d{2,4}[A-Z]?$/.test(code) || !term) continue;
      const grade = value("grade"), creditsText = value("credits");
      const creditNumber = Number(creditsText.replace(/[()]/g, ""));
      const inProgress = /\(.*\)/.test(creditsText) || /^(IP|INP|IN PROGRESS)$/i.test(grade);
      const status = inProgress ? "in-progress" : /^(F|W|WF|NP|NC|I|INC|AU)$/i.test(grade) ? "not-completed" : /^(A[+-]?|B[+-]?|C[+-]?|D[+-]?|P|CR|S|TR|T|AP)$/i.test(grade) ? "completed" : "unknown";
      const key = `${code}|${term}|${grade}`;
      const existing = courseMap.get(key);
      if (existing) { if (block && !existing.blocks.includes(block)) existing.blocks.push(block); continue; }
      courseMap.set(key, { code, title: value("title"), grade, term, credits: creditsText && Number.isFinite(creditNumber) ? creditNumber : null, status, blocks: block ? [block] : [] });
    }
  }
  if (!requirements.length) return { error: "No supported academic audit found. Open your Academic worksheet in Degree Works and let it finish loading." };
  const courses = Array.from(courseMap.values());
  const collapsed = Array.from(document.querySelectorAll('.MuiAccordionSummary-root[aria-expanded="false"]')).filter((el) => el.querySelector("h3")).length;
  return { version: 2, checkedAt: new Date().toISOString(), source: "Degree Works Academic worksheet", partial: true,
    profile, blocks, courses, requirements,
    warnings: ["Imported from the loaded worksheet, not an official transcript or verified complete audit.", ...(collapsed ? [`${collapsed} academic blocks remained collapsed.`] : []), ...(!courses.length ? ["Course history could not be read from this worksheet."] : [])] };
}

export async function importDegreeAudit(tab) {
  if (!tab?.id || !tab.url) throw new Error("Open your Degree Works audit first.");
  const url = new URL(tab.url);
  if (url.protocol !== "https:" || url.hostname !== "degreeworks.fandm.edu") throw new Error("Open your F&M Academic worksheet, then click Import Degree Works.");
  const [{ result: audit }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractDegreeAudit });
  if (audit?.error) throw new Error(audit.error);
  if (!audit?.requirements?.length) throw new Error("Could not read the audit. Reload Degree Works and try again.");
  // Confirm in the source tab. A service-worker caller survives the popup closing.
  const [{ result: approved }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (summary) => confirm(summary), args: [
    `Import Degree Works?\n\n${audit.requirements.length} requirements, ${audit.courses?.length || 0} course records, ${audit.blocks?.length || 0} academic blocks.\n\nIncludes program, placement results, course titles, terms, grades and credits where available.\n\nSaved locally in your browser for the planner and its recommendations. If you ask the planner's AI assistant a question, it shares only a summary with the AI service: requirement names and statuses, class year, graduation year, major, placement results and the course codes you've taken. Never grades, your name or student ID. This is a worksheet snapshot and may be incomplete.`,
  ] });
  if (!approved) return false;
  await chrome.storage.local.set({ degreeAudit: audit });
  await chrome.tabs.create({ url: "http://localhost:3000/" });
  return { requirements: audit.requirements.length, courses: audit.courses?.length || 0 };
}
