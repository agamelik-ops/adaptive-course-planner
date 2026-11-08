// Degree Works audit, as captured by the Chrome extension (extension/background.js).
// The extension's bridge script (extension/bridge.js) forwards it to this page with
// window.postMessage; it can also be pasted into the chat as JSON.

export type RequirementStatus = "complete" | "in-progress" | "incomplete" | "unknown";
export type Requirement = { name: string; status: RequirementStatus };
export type StudentLevel = "FR" | "SO" | "JR" | "SR";
// Only these two header fields are captured; never name, ID or GPA.
export type StudentInfo = { classLevel?: StudentLevel; classLevelLabel?: string; expectedGraduation?: string };
export type DegreeAudit = {
  version: number;
  checkedAt: string;
  source: string;
  partial: boolean;
  requirements: Requirement[];
  student?: StudentInfo;
};

const LEVELS = new Set<StudentLevel>(["FR", "SO", "JR", "SR"]);
// Planning term is Spring 2027, so graduating in 2027 means senior, 2030 means first-year.
const SPRING_TERM_YEAR = 2027;

function parseStudent(value: unknown): StudentInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const info: StudentInfo = {};
  if (typeof raw.classLevel === "string" && LEVELS.has(raw.classLevel as StudentLevel)) info.classLevel = raw.classLevel as StudentLevel;
  if (typeof raw.classLevelLabel === "string") info.classLevelLabel = raw.classLevelLabel.slice(0, 30);
  if (typeof raw.expectedGraduation === "string" && /\d{4}/.test(raw.expectedGraduation)) info.expectedGraduation = raw.expectedGraduation.slice(0, 30);
  return info.classLevel || info.expectedGraduation ? info : undefined;
}

/** Class year for the Spring 2027 term: Degree Works' class level first, else from graduation year. */
export function classYearFromAudit(audit: DegreeAudit | null): StudentLevel | undefined {
  const student = audit?.student;
  if (!student) return undefined;
  if (student.classLevel) return student.classLevel;
  const year = Number(student.expectedGraduation?.match(/\d{4}/)?.[0]);
  const yearsLeft = year - SPRING_TERM_YEAR;
  return yearsLeft <= 0 ? "SR" : yearsLeft === 1 ? "JR" : yearsLeft === 2 ? "SO" : yearsLeft >= 3 ? "FR" : undefined;
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
  const requirements = candidate.requirements
    .filter((item): item is Requirement =>
      !!item && typeof item.name === "string" && STATUSES.has(item.status as RequirementStatus))
    .map((item) => ({ name: item.name.replace(/\s+/g, " ").trim(), status: item.status }));
  if (requirements.length === 0) return null;
  return {
    version: typeof candidate.version === "number" ? candidate.version : 1,
    checkedAt: typeof candidate.checkedAt === "string" ? candidate.checkedAt : new Date().toISOString(),
    source: typeof candidate.source === "string" ? candidate.source : "Degree Works",
    partial: candidate.partial !== false,
    requirements,
    student: parseStudent(candidate.student),
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
