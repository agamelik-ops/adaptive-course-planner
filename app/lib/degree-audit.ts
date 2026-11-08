// Degree Works audit, as captured by the Chrome extension (extension/background.js).
// The extension's bridge script (extension/bridge.js) forwards it to this page with
// window.postMessage; it can also be pasted into the chat as JSON.

export type RequirementStatus = "complete" | "in-progress" | "incomplete" | "unknown";
export type Requirement = { name: string; status: RequirementStatus };
export type DegreeAudit = {
  version: number;
  checkedAt: string;
  source: string;
  partial: boolean;
  requirements: Requirement[];
};

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
    if (audit) saveAudit(audit);
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
