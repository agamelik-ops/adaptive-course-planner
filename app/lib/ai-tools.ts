// Tools the AI model can call. They run on the server against the real
// Spring 2027 catalog, so the model can't invent courses, CRNs or times.

import { COURSES } from "../planner/courses";
import { courses, meeting, overlaps, searchCourses, type Course } from "./courses";
import type { ClassYear } from "./advisor";

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4 };
const TAGS = ["ARTS", "HUMA", "SOCS", "NATL", "NSIP", "WRLD", "NONW", "LANG"] as const;
const BY_CRN = new Map(courses.map((course) => [course.crn, course]));
const DESCRIPTIONS = new Map(COURSES.map((course) => [course.crn, course.description]));

export type StudentContext = {
  plan: Course[];
  classYear?: ClassYear;
  expectedGraduation?: string;
  language?: string;
  major?: string;
  audit?: { open: string[]; inProgress: string[]; complete: string[] };
};

export type AiSuggestion = { crn: string; requirement: string; reason: string };

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_courses",
      description: "Search Spring 2027 sections. Combine filters as needed. Returns at most `limit` sections (default 6, max 10) with times, instructors, gen-ed tags and prerequisites.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text: subject name, course code (e.g. 'CPS 111'), title words, or instructor name." },
          requirement_tag: { type: "string", enum: [...TAGS], description: "Gen-ed tag: ARTS, HUMA (humanities), SOCS (social science), NATL (natural science with lab), NSIP (natural science in perspective), WRLD (world perspectives), NONW (non-Western), LANG (language)." },
          subject: { type: "string", description: "Subject prefix such as CPS, ECO, SPA." },
          max_level: { type: "integer", description: "Highest course number to include, e.g. 199 for intro courses." },
          exclude_days: { type: "array", items: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri"] }, description: "Skip sections meeting on these days." },
          earliest_start: { type: "string", description: "Skip sections starting before this 24h time, e.g. '10:00'." },
          latest_end: { type: "string", description: "Skip sections ending after this 24h time, e.g. '17:00'." },
          fits_plan: { type: "boolean", description: "Only sections with no time conflict with the student's plan. Default true." },
          limit: { type: "integer", description: "Max results, default 6, max 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_course_details",
      description: "Full details for one section by CRN, including the course description and prerequisites.",
      parameters: { type: "object", properties: { crn: { type: "string" } }, required: ["crn"] },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_courses",
      description: "Show the student course cards they can Accept (adds to their calendar) or Reject. Use this whenever you recommend specific sections. Only use CRNs returned by search_courses or get_course_details.",
      parameters: {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                crn: { type: "string" },
                requirement: { type: "string", description: "Short label of what it counts toward, e.g. 'Arts' or 'Language (201+)' or 'Exploring economics'." },
                reason: { type: "string", description: "One sentence on why it fits this student." },
              },
              required: ["crn", "requirement", "reason"],
            },
          },
        },
        required: ["suggestions"],
      },
    },
  },
] as const;

function toMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Compact on purpose: tool results count against the AI provider's token limits.
function brief(course: Course) {
  return {
    crn: course.crn,
    course: `${course.code}${course.section ? ` ${course.section}` : ""}: ${course.title}`,
    times: meeting(course),
    instructor: course.instructors.map((name) => name.replace(/,\s*\.?\s*$/, "")).join("; ") || undefined,
    tags: course.dist.join(",") || undefined,
    prereq: course.prereq ? course.prereq.slice(0, 120) : undefined,
    permission: course.permission || undefined,
    closed_to: course.closedTo.join(",") || undefined,
  };
}

// Models sometimes send names ("World Perspectives", "Friday") instead of codes.
const TAG_NAMES: [RegExp, string][] = [
  [/^arts?$/i, "ARTS"], [/humanit/i, "HUMA"], [/social/i, "SOCS"], [/in perspective|nsip/i, "NSIP"],
  [/lab|natural science/i, "NATL"], [/world/i, "WRLD"], [/non.?western/i, "NONW"], [/lang/i, "LANG"],
];
function toTag(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const upper = value.trim().toUpperCase();
  if ((TAGS as readonly string[]).includes(upper)) return upper;
  return TAG_NAMES.find(([pattern]) => pattern.test(value))?.[1] ?? upper;
}
function toDay(value: unknown) {
  const key = String(value ?? "").trim().slice(0, 3).toLowerCase();
  return DAY_INDEX[key.charAt(0).toUpperCase() + key.slice(1)];
}

function searchTool(args: Record<string, unknown>, ctx: StudentContext) {
  let list = typeof args.query === "string" && args.query.trim() ? searchCourses(args.query) : courses;
  const tag = toTag(args.requirement_tag);
  const subject = typeof args.subject === "string" ? args.subject.toUpperCase().trim() : "";
  const maxLevel = typeof args.max_level === "number" ? args.max_level : null;
  const excluded = Array.isArray(args.exclude_days) ? args.exclude_days.map(toDay).filter((day) => day !== undefined) : [];
  const earliest = toMinutes(args.earliest_start);
  const latest = toMinutes(args.latest_end);
  const fitsPlan = args.fits_plan !== false;
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);
  const planCodes = new Set(ctx.plan.map((course) => course.code));

  list = list.filter((course) =>
    course.meetings.length > 0 &&
    (!tag || course.dist.includes(tag)) &&
    (!subject || course.code.startsWith(`${subject} `)) &&
    (maxLevel === null || (parseInt(course.code.split(" ")[1], 10) || 0) <= maxLevel) &&
    !course.meetings.some((item) => item.days.some((day) => excluded.includes(day))) &&
    (earliest === null || course.meetings.every((item) => item.start >= earliest)) &&
    (latest === null || course.meetings.every((item) => item.end <= latest)) &&
    !(ctx.classYear && course.closedTo.includes(ctx.classYear)) &&
    !planCodes.has(course.code) &&
    (!fitsPlan || !ctx.plan.some((other) => overlaps(course, other))));

  return { total_matches: list.length, results: list.slice(0, limit).map(brief) };
}

function detailsTool(args: Record<string, unknown>) {
  const course = BY_CRN.get(String(args.crn ?? "").trim());
  if (!course) return { error: "No Spring 2027 section has that CRN." };
  return { ...brief(course), description: (DESCRIPTIONS.get(course.crn) || "No description available.").slice(0, 700) };
}

function suggestTool(args: Record<string, unknown>, ctx: StudentContext, collected: AiSuggestion[]) {
  const items = Array.isArray(args.suggestions) ? args.suggestions.slice(0, 6) : [];
  const accepted: string[] = [];
  const problems: string[] = [];
  for (const raw of items) {
    const item = raw as Partial<AiSuggestion>;
    const course = BY_CRN.get(String(item.crn ?? "").trim());
    if (!course) { problems.push(`${item.crn}: not a real CRN`); continue; }
    const others = [...ctx.plan, ...collected.map((entry) => BY_CRN.get(entry.crn)!)];
    const clash = others.find((other) => overlaps(course, other));
    if (clash) { problems.push(`${course.code} (${course.crn}) overlaps ${clash.code}`); continue; }
    if (collected.some((entry) => entry.crn === course.crn)) continue;
    collected.push({
      crn: course.crn,
      requirement: String(item.requirement ?? "Suggested").slice(0, 60),
      reason: String(item.reason ?? "").slice(0, 240),
    });
    accepted.push(`${course.code} (${course.crn})`);
  }
  return { shown_to_student: accepted, not_shown: problems };
}

export function runTool(name: string, args: Record<string, unknown>, ctx: StudentContext, collected: AiSuggestion[]) {
  switch (name) {
    case "search_courses": return searchTool(args, ctx);
    case "get_course_details": return detailsTool(args);
    case "suggest_courses": return suggestTool(args, ctx, collected);
    default: return { error: `Unknown tool ${name}` };
  }
}

export function courseByCrn(crn: string) {
  return BY_CRN.get(crn);
}
