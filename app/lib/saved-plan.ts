import { courses, type Course } from "./courses";

// Keep semesters separate, and store identifiers rather than stale course details.
export const PLAN_KEY = "fm-course-planner:spring-2027:v1";
const CHANGE_EVENT = "fm-plan-change";
let sessionPlan: string | null = null;
let storageFailed = false;

export function readPlan(): string | null {
  if (storageFailed) return sessionPlan;
  try {
    sessionPlan = window.localStorage.getItem(PLAN_KEY);
  } catch {
    storageFailed = true;
  }
  return sessionPlan;
}

export function restoreCourses(raw: string | null): Course[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const ids = new Set(parsed.filter((value): value is string => typeof value === "string"));
    return courses.filter((course) => ids.has(course.crn));
  } catch {
    return [];
  }
}

export function savePlan(selected: Course[]): boolean {
  sessionPlan = JSON.stringify(selected.map((course) => course.crn));
  let saved = true;
  try {
    window.localStorage.setItem(PLAN_KEY, sessionPlan);
    storageFailed = false;
  } catch {
    storageFailed = true;
    saved = false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

export function subscribePlan(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PLAN_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// Match the server-rendered empty plan until the browser hydrates.
export function serverPlan() { return null; }
