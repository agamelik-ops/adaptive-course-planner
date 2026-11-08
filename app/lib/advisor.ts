// Rule-based course advisor: turns Degree Works requirement names into catalog
// filters and ranks Spring 2027 sections that would help satisfy them.
// A real AI can later call these same helpers to ground its answers in the catalog.

import { courses, overlaps, type Course } from "./courses";
import type { DegreeAudit, RequirementStatus } from "./degree-audit";

export type ClassYear = "FR" | "SO" | "JR" | "SR";
export type NeedKind = "dist" | "language" | "major" | "connections";

export type Need = {
  id: string;
  label: string; // friendly name, e.g. "Arts"
  kind: NeedKind;
  dist?: string[]; // catalog tags that count toward it
  status: RequirementStatus;
  sources: string[]; // original Degree Works requirement names
};

export type AuditSummary = {
  open: Need[]; // still incomplete: worth recommending courses for
  inProgress: Need[]; // satisfied once current classes finish
  complete: Need[];
  unmatched: string[]; // requirement names we couldn't interpret
};

type Rule = { test: RegExp; need: Omit<Need, "status" | "sources"> } | { test: RegExp; skip: true };

// Order matters: the first matching rule wins.
const RULES: Rule[] = [
  { test: /phase|distribution areas|^natural science requirement$/i, skip: true }, // umbrella headings
  { test: /major (is )?not declared|major requirements/i, need: { id: "major", label: "Major requirements", kind: "major" } },
  { test: /language|201 level|3rd-semester/i, need: { id: "language", label: "Language (201 level or higher)", kind: "language" } },
  { test: /connections/i, need: { id: "connections", label: "Connections seminar", kind: "connections" } },
  { test: /natural science in perspective|2nd lab/i, need: { id: "nsip", label: "Natural Science in Perspective or 2nd lab", kind: "dist", dist: ["NSIP", "NATL"] } },
  { test: /natural science lab|lab course/i, need: { id: "natl", label: "Natural Science with Lab", kind: "dist", dist: ["NATL"] } },
  { test: /non-?western/i, need: { id: "nonw", label: "Non-Western Cultures", kind: "dist", dist: ["NONW"] } },
  { test: /world perspectives?/i, need: { id: "wrld", label: "World Perspectives", kind: "dist", dist: ["WRLD"] } },
  { test: /\barts?\b/i, need: { id: "arts", label: "Arts", kind: "dist", dist: ["ARTS"] } },
  { test: /humanities/i, need: { id: "huma", label: "Humanities", kind: "dist", dist: ["HUMA"] } },
  { test: /social science/i, need: { id: "socs", label: "Social Sciences", kind: "dist", dist: ["SOCS"] } },
];

const STATUS_RANK: Record<RequirementStatus, number> = { incomplete: 3, unknown: 2, "in-progress": 1, complete: 0 };

export function summarizeAudit(audit: DegreeAudit): AuditSummary {
  const needs = new Map<string, Need>();
  const unmatched: string[] = [];
  for (const requirement of audit.requirements) {
    const rule = RULES.find((item) => item.test.test(requirement.name));
    if (!rule) { unmatched.push(requirement.name); continue; }
    if ("skip" in rule) continue;
    const existing = needs.get(rule.need.id);
    if (!existing) {
      needs.set(rule.need.id, { ...rule.need, status: requirement.status, sources: [requirement.name] });
    } else {
      existing.sources.push(requirement.name);
      // Several Degree Works lines can map to one need; the least-finished one wins.
      if (STATUS_RANK[requirement.status] > STATUS_RANK[existing.status]) existing.status = requirement.status;
    }
  }
  const all = [...needs.values()];
  return {
    open: all.filter((need) => need.status === "incomplete" || need.status === "unknown"),
    inProgress: all.filter((need) => need.status === "in-progress"),
    complete: all.filter((need) => need.status === "complete"),
    unmatched,
  };
}

export const LANGUAGE_SUBJECTS: Record<string, string> = {
  CHN: "Chinese", FRN: "French", GER: "German", GRK: "Ancient Greek", ITA: "Italian",
  JPN: "Japanese", LAT: "Latin", RUS: "Russian", SPA: "Spanish",
};

export const MAJOR_OPTIONS: Record<string, string> = {
  BIO: "Biology", BOS: "Business (BOS)", CHM: "Chemistry", CPS: "Computer Science",
  ECO: "Economics", ENG: "English", GOV: "Government", HIS: "History",
  MAT: "Mathematics", PHI: "Philosophy", PSY: "Psychology", SOC: "Sociology",
};

export function prefixOf(course: Course) { return course.code.split(" ")[0]; }
export function numberOf(course: Course) { return parseInt(course.code.split(" ")[1] ?? "0", 10) || 0; }

/** Match free text like "comp sci", "economics" or "CPS" to a subject prefix. */
export function matchSubject(text: string, options: Record<string, string>): string | null {
  const value = text.toLowerCase().replace(/[^a-z ]/g, " ").trim();
  if (!value) return null;
  for (const [prefix, name] of Object.entries(options)) {
    const lower = name.toLowerCase();
    if (value === prefix.toLowerCase() || value.includes(lower) || lower.includes(value)) return prefix;
  }
  if (/comp(uter)? ?sci|\bcs\b|coding|programming/.test(value)) return options.CPS ? "CPS" : null;
  if (/\becon/.test(value)) return options.ECO ? "ECO" : null;
  if (/\bbusiness|\bbos\b/.test(value)) return options.BOS ? "BOS" : null;
  if (/\bpolitic|\bgov/.test(value)) return options.GOV ? "GOV" : null;
  if (/\bpsych/.test(value)) return options.PSY ? "PSY" : null;
  if (/\bbio/.test(value)) return options.BIO ? "BIO" : null;
  if (/\bchem/.test(value)) return options.CHM ? "CHM" : null;
  if (/\bmath/.test(value)) return options.MAT ? "MAT" : null;
  return null;
}

export type AdvisorContext = {
  plan: Course[]; // courses already in the student's plan
  pending: Course[]; // suggestions not yet accepted or rejected
  rejected: Set<string>; // CRNs the student turned down
  classYear?: ClassYear;
  languagePrefix?: string;
  majorPrefix?: string;
};

function candidatesFor(need: Need, ctx: AdvisorContext): Course[] {
  switch (need.kind) {
    case "dist":
      return courses.filter((course) => need.dist!.some((tag) => course.dist.includes(tag)));
    case "language": {
      const isUpperLanguage = (course: Course) =>
        course.code.split(" ")[0] in LANGUAGE_SUBJECTS && numberOf(course) >= 201 &&
        (course.dist.includes("LANG") || course.prereq.toUpperCase().includes(prefixOf(course)));
      return courses.filter((course) => isUpperLanguage(course) && (!ctx.languagePrefix || prefixOf(course) === ctx.languagePrefix));
    }
    case "major":
      return ctx.majorPrefix ? courses.filter((course) => prefixOf(course) === ctx.majorPrefix) : [];
    case "connections":
      return []; // Connections seminars aren't part of the Spring master schedule.
  }
}

/** Ranked sections for a need, skipping anything that conflicts or can't be taken. */
export function recommend(need: Need, ctx: AdvisorContext, limit = 3): Course[] {
  const busy = [...ctx.plan, ...ctx.pending];
  const takenCodes = new Set(busy.map((course) => course.code));
  return candidatesFor(need, ctx)
    .filter((course) =>
      course.meetings.length > 0 &&
      !course.permission &&
      !ctx.rejected.has(course.crn) &&
      !takenCodes.has(course.code) &&
      !(ctx.classYear && course.closedTo.includes(ctx.classYear)) &&
      !busy.some((other) => overlaps(course, other)))
    .sort((a, b) =>
      Number(!!a.prereq) - Number(!!b.prereq) || // no prerequisites first
      (need.kind === "language" ? numberOf(a) - numberOf(b) : 0) ||
      Math.min(numberOf(a), 400) - Math.min(numberOf(b), 400) || // intro level first
      a.crn.localeCompare(b.crn))
    // One section per course so alternatives are genuinely different classes.
    .filter((course, index, list) => list.findIndex((other) => other.code === course.code) === index)
    .slice(0, limit);
}

export function reasonFor(need: Need, course: Course): string {
  switch (need.kind) {
    case "language": return `Counts toward your language requirement (${LANGUAGE_SUBJECTS[prefixOf(course)] ?? "language"} at the 201+ level).`;
    case "major": return `An entry point into ${MAJOR_OPTIONS[prefixOf(course)] ?? course.subject}, toward your major.`;
    default: return `Counts toward ${need.label}${course.dist.length > 1 ? ` (also tagged ${course.dist.filter((tag) => !need.dist?.includes(tag)).join(", ")})` : ""}.`;
  }
}
