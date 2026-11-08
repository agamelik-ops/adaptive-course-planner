// Degree Works audit, as captured by the Chrome extension (extension/background.js).
// The extension's bridge script (extension/bridge.js) forwards it to this page with
// window.postMessage; it can also be pasted into the chat as JSON.

export type RequirementStatus = "complete" | "in-progress" | "incomplete" | "unknown";
export type Requirement = { name: string; status: RequirementStatus; block?: string; details?: string };
export type AcademicCourse = {
  code: string; title: string; grade: string; term: string; credits: number | null;
  status: "completed" | "in-progress" | "not-completed" | "unknown";
  blocks: string[];
};
export type AcademicProfile = Partial<Record<"degree" | "major" | "minor" | "concentration" | "earnedCredits" | "languagePlacement" | "mathPlacement" | "graduationYear", string>>;
export type DegreeAudit = {
  version: number;
  checkedAt: string;
  source: string;
  partial: boolean;
  requirements: Requirement[];
  profile?: AcademicProfile;
  courses?: AcademicCourse[];
  blocks?: { name: string; catalogYear?: string }[];
  warnings?: string[];
};

export type StudentLevel = "FR" | "SO" | "JR" | "SR";
// Planning term is Spring 2027, so graduating in 2027 means senior, 2030 means first-year.
const SPRING_TERM_YEAR = 2027;

/** Class year for the Spring 2027 term, from Degree Works' "Anticipated Grad Year". */
export function classYearFromAudit(audit: DegreeAudit | null): StudentLevel | undefined {
  const year = Number(audit?.profile?.graduationYear?.match(/\d{4}/)?.[0]);
  if (!year) return undefined;
  const yearsLeft = year - SPRING_TERM_YEAR;
  return yearsLeft <= 0 ? "SR" : yearsLeft === 1 ? "JR" : yearsLeft === 2 ? "SO" : "FR";
}

const AUDIT_KEY = "fm-course-planner:degree-audit:v1";
const CHANGE_EVENT = "fm-audit-change";
const BRIDGE_SOURCE = "fm-planner-extension";
const STATUSES = new Set<RequirementStatus>(["complete", "in-progress", "incomplete", "unknown"]);

export function parseAudit(value: unknown): DegreeAudit | null {
  const raw = (value && typeof value === "object" && "degreeAudit" in value)
    ? (value as { degreeAudit: unknown }).degreeAudit
    : value;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DegreeAudit>;
  if (!Array.isArray(candidate.requirements)) return null;
  const text = (value: unknown, max = 500) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const requirements = candidate.requirements.slice(0, 2000)
    .filter((item): item is Requirement =>
      !!item && typeof item.name === "string" && STATUSES.has(item.status as RequirementStatus))
    .map((item) => ({ name: text(item.name), status: item.status, block: text(item.block), details: text(item.details, 4000) })).filter((item) => item.name);
  if (requirements.length === 0) return null;
  const profile: AcademicProfile = {};
  for (const key of ["degree", "major", "minor", "concentration", "earnedCredits", "languagePlacement", "mathPlacement", "graduationYear"] as const) {
    const value = text(candidate.profile?.[key]);
    if (value) profile[key] = value;
  }
  const courses: AcademicCourse[] = [];
  const seen = new Set<string>();
  for (const row of (Array.isArray(candidate.courses) ? candidate.courses.slice(0, 2000) : [])) {
    if (!row || typeof row !== "object") continue;
    const code = text(row.code).toUpperCase();
    const term = text(row.term);
    if (!/^[A-Z]{2,5}\s+\d{2,4}[A-Z]?$/.test(code) || !term) continue;
    const grade = text(row.grade);
    const id = `${code}|${term}|${grade}`;
    if (seen.has(id)) continue;
    seen.add(id);
    courses.push({ code, term, grade, title: text(row.title),
      credits: typeof row.credits === "number" && Number.isFinite(row.credits) && row.credits >= 0 ? row.credits : null,
      status: ["completed", "in-progress", "not-completed", "unknown"].includes(row.status) ? row.status : "unknown",
      blocks: Array.isArray(row.blocks) ? row.blocks.slice(0, 50).map((block: unknown) => text(block)).filter(Boolean) : [],
    });
  }
  return {
    profile, courses,
    blocks: Array.isArray(candidate.blocks) ? candidate.blocks.slice(0, 100).filter((block) => block && typeof block.name === "string").map((block) => ({ name: text(block.name), catalogYear: text(block.catalogYear) })) : [],
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings.slice(0, 30).map((warning) => text(warning)).filter(Boolean) : [],
    version: typeof candidate.version === "number" ? candidate.version : 1,
    checkedAt: typeof candidate.checkedAt === "string" ? candidate.checkedAt : new Date().toISOString(),
    source: typeof candidate.source === "string" ? candidate.source : "Degree Works",
    partial: candidate.partial !== false,
    requirements,
  };
}

export function readAudit(): DegreeAudit | null {
  try {
    return parseAudit(JSON.parse(window.localStorage.getItem(AUDIT_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function saveAudit(audit: DegreeAudit) {
  try {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(audit));
  } catch {
    // Storage blocked (private window etc.); the audit still works for this visit.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: audit }));
}

export function clearAudit() {
  try {
    window.localStorage.removeItem(AUDIT_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: null }));
}

/** Listen for audits from the extension bridge or from saveAudit/clearAudit. */
export function subscribeAudit(onChange: (audit: DegreeAudit | null) => void) {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: string; type?: string; audit?: unknown } | null;
    if (data?.source !== BRIDGE_SOURCE || data.type !== "degree-audit") return;
    const audit = parseAudit(data.audit);
    if (!audit) return;
    // Keep the newest import. An older copy of the extension (or a stale bridge)
    // can send an outdated audit after a fresh one; ignore it.
    const current = readAudit();
    if (current && Date.parse(current.checkedAt) > Date.parse(audit.checkedAt)) return;
    saveAudit(audit);
  };
  const onLocal = (event: Event) => onChange((event as CustomEvent<DegreeAudit | null>).detail);
  window.addEventListener("message", onMessage);
  window.addEventListener(CHANGE_EVENT, onLocal);
  // Ask the bridge for the latest audit in case it loaded before we started listening.
  window.postMessage({ source: "fm-planner-page", type: "request-degree-audit" }, window.location.origin);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener(CHANGE_EVENT, onLocal);
  };
}
