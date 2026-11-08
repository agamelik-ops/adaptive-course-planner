// Tools the AI model can call. They run on the server against the real
// Spring 2027 catalog, so the model can't invent courses, CRNs or times.

import { COURSES } from "../planner/courses";
import { courses, meeting, overlaps, searchCourses, subjects, type Course } from "./courses";
import { matchSubject, needFromId, LANGUAGE_SUBJECTS, type ClassYear } from "./advisor";
import { checkPrereq, makeRecord, parsePlacements, type StudentRecord } from "./prereqs";
import { buildSchedule, majorPrefixFromProfile } from "./schedule";

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4 };
const TAGS = ["ARTS", "HUMA", "SOCS", "NATL", "NSIP", "WRLD", "NONW", "LANG"] as const;
const BY_CRN = new Map(courses.map((course) => [course.crn, course]));
const DESCRIPTIONS = new Map(COURSES.map((course) => [course.crn, course.description]));

export type StudentContext = {
  plan: Course[];
  classYear?: ClassYear;
  expectedGraduation?: string;
  declaredMajor?: string;
  languagePlacement?: string;
  mathPlacement?: string;
  takenCodes?: string[]; // completed or in-progress course codes, e.g. "SPA 101"
  language?: string;
  major?: string;
  majorSubject?: string; // subject prefix the student chose in chat, e.g. "CPS"
  majorUndecided?: boolean; // the student said they're not sure about a major yet
  languageSubject?: string; // e.g. "FRN"
  audit?: { open: string[]; inProgress: string[]; complete: string[] };
  needIds?: { open: string[]; satisfied: string[] }; // advisor need ids, for build_schedule
};

/** What the student has taken and placed into, for prerequisite checks. */
function recordFor(ctx: StudentContext): StudentRecord {
  return makeRecord(ctx.takenCodes ?? [], parsePlacements(ctx.languagePlacement, ctx.mathPlacement), ctx.plan.map((course) => course.code));
}
function majorFor(ctx: StudentContext, override?: unknown): string | null {
  if (typeof override === "string" && override.trim()) return matchSubject(override, { ...subjects, ...LANGUAGE_SUBJECTS }) ?? override.trim().toUpperCase().slice(0, 4);
  return ctx.majorSubject || majorPrefixFromProfile(ctx.declaredMajor);
}

export type AiSuggestion = { crn: string; requirement: string; reason: string };

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_courses",
      description: "Search Spring 2027 sections. Combine filters as needed. Returns at most `limit` sections (default 6, max 10) with times, instructors, gen-ed tags and prerequisites. A query that names a professor or a course code returns all their sections (every result is offered this spring), labeled student_took_this_course_before / in_plan / prereq_status; other searches hide courses the student took or can't take yet.",
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
          eligible_only: { type: "boolean", description: "Hide sections whose prerequisites the student hasn't met (based on Degree Works history and placements). Default true." },
          limit: { type: "integer", description: "Max results, default 6, max 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_course_details",
      description: "Full details for one section by CRN (or a course code like 'CPS 222'), including the description and whether this student meets its prerequisites.",
      parameters: { type: "object", properties: { crn: { type: "string", description: "CRN or course code" } }, required: ["crn"] },
    },
  },
  {
    type: "function",
    function: {
      name: "build_schedule",
      description: "Build a full Spring 2027 schedule for this student (default 4 courses including what's already in their plan). Uses their Degree Works history, placements and unfinished requirements; prioritizes the next courses in their major, then language and requirements, then electives; checks prerequisites, class-year restrictions, permission and time conflicts. The picks are shown to the student as Accept/Reject cards automatically. Also returns major courses they can't take yet and why.",
      parameters: {
        type: "object",
        properties: {
          major_subject: { type: "string", description: "Major to plan around (subject code like 'CPS' or a name like 'Economics'). Omit to use their declared/chosen major; if they have none, the plan focuses on requirements and exploration." },
          language_subject: { type: "string", description: "Language they're studying, if different from what their placements suggest." },
          total_courses: { type: "integer", description: "Total courses wanted in the semester, default 4." },
          undecided: { type: "boolean", description: "Set true only after the student said they aren't sure what to major in." },
          exclude_days: { type: "array", items: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri"] } },
          earliest_start: { type: "string", description: "24h time, e.g. '10:00'." },
          latest_end: { type: "string", description: "24h time, e.g. '17:00'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_prerequisites",
      description: "Check whether this student can take a course next semester based on their Degree Works history and placements. Returns met, unmet (with what's missing) or unknown (e.g. needs instructor permission).",
      parameters: { type: "object", properties: { course: { type: "string", description: "CRN or course code like 'CPS 222'" } }, required: ["course"] },
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
                reason: { type: "string", description: "Why it fits, under 10 words, e.g. 'Builds on CPS 112' or 'Covers Arts, no prerequisites'." },
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

// "Jing Hu" matches the instructor "Hu, Jing" (whole name words, so "art" doesn't match "Bartholomew").
function isInstructorQuery(query: string, list: Course[]) {
  const words = query.toLowerCase().split(/[\s,.]+/).filter((word) => word.length > 1);
  return words.length > 0 && list.some((course) => course.instructors.some((name) => {
    const parts = name.toLowerCase().split(/[\s,.]+/);
    return words.every((word) => parts.includes(word));
  }));
}

function searchTool(args: Record<string, unknown>, ctx: StudentContext) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  let list = query ? searchCourses(query) : courses;
  // Looking up a professor or a specific course is a factual question: list every
  // section and label it, instead of hiding ones the student took or can't take yet.
  const lookup = !!query && (/^[A-Z]{2,4}\s?\d{3}/i.test(query) || isInstructorQuery(query, list));
  const tag = toTag(args.requirement_tag);
  const subject = typeof args.subject === "string" ? args.subject.toUpperCase().trim() : "";
  const maxLevel = typeof args.max_level === "number" ? args.max_level : null;
  const excluded = Array.isArray(args.exclude_days) ? args.exclude_days.map(toDay).filter((day) => day !== undefined) : [];
  const earliest = toMinutes(args.earliest_start);
  const latest = toMinutes(args.latest_end);
  const fitsPlan = args.fits_plan !== false;
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);
  // Skip courses already in the plan or already taken (per Degree Works).
  const planCodes = new Set([...ctx.plan.map((course) => course.code), ...(ctx.takenCodes ?? [])]);
  const record = recordFor(ctx);
  const eligibleOnly = args.eligible_only !== false;

  list = list.filter((course) =>
    course.meetings.length > 0 &&
    (!tag || course.dist.includes(tag)) &&
    (!subject || course.code.startsWith(`${subject} `)) &&
    (maxLevel === null || (parseInt(course.code.split(" ")[1], 10) || 0) <= maxLevel) &&
    !course.meetings.some((item) => item.days.some((day) => excluded.includes(day))) &&
    (earliest === null || course.meetings.every((item) => item.start >= earliest)) &&
    (latest === null || course.meetings.every((item) => item.end <= latest)) &&
    (lookup || (
      !(ctx.classYear && course.closedTo.includes(ctx.classYear)) &&
      !planCodes.has(course.code) &&
      (!fitsPlan || !ctx.plan.some((other) => overlaps(course, other))) &&
      (!eligibleOnly || checkPrereq(course, record).status !== "unmet"))));

  const taken = new Set(ctx.takenCodes ?? []);
  return {
    total_matches: list.length,
    results: list.slice(0, limit).map((course) => ({
      ...brief(course),
      prereq_status: checkPrereq(course, record).status,
      ...(lookup ? {
        student_took_this_course_before: taken.has(course.code) || undefined,
        in_plan: ctx.plan.some((other) => other.crn === course.crn) || undefined,
        closed_to_student: (ctx.classYear && course.closedTo.includes(ctx.classYear)) || undefined,
      } : {}),
    })),
  };
}

function findSection(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase().replace(/^([A-Z]{2,4})\s*(\d)/, "$1 $2");
  return BY_CRN.get(text) ?? courses.find((course) => course.code === text && !/^lab$/i.test(course.title));
}

function detailsTool(args: Record<string, unknown>, ctx: StudentContext) {
  const course = findSection(args.crn);
  if (!course) return { error: "No Spring 2027 section has that CRN or course code." };
  const check = checkPrereq(course, recordFor(ctx));
  return { ...brief(course), prerequisite_check: check, description: (DESCRIPTIONS.get(course.crn) || "No description available.").slice(0, 700) };
}

function prereqTool(args: Record<string, unknown>, ctx: StudentContext) {
  const course = findSection(args.course);
  if (!course) return { error: "No Spring 2027 section has that CRN or course code." };
  const taken = (ctx.takenCodes ?? []).includes(course.code);
  const result = checkPrereq(course, recordFor(ctx));
  // Real titles for the courses named in the prerequisite, so the AI never guesses them.
  // (Skip "PLACEMENT IN 222", which isn't a course called "IN 222".)
  const mentioned = [...new Set([...course.prereq.toUpperCase().replace(/PLACEMENT IN \d{3}/g, "").matchAll(/\b([A-Z]{2,4})\s?(\d{3})/g)].map((m) => `${m[1]} ${m[2]}`))];
  const prerequisite_courses = mentioned.map((code) => {
    const offered = courses.find((item) => item.code === code && !/^lab$/i.test(item.title));
    return `${code}${offered ? ` ${offered.title}` : ""}: ${(ctx.takenCodes ?? []).includes(code) ? "taken" : offered ? "not taken, offered Spring 2027" : "not taken, not offered this spring"}`;
  });
  return { course: `${course.code}: ${course.title}`, already_taken: taken || undefined, ...result, prerequisite_courses,
    closed_to_class_year: ctx.classYear && course.closedTo.includes(ctx.classYear) ? true : undefined, needs_permission: course.permission || undefined };
}

const DAY_NAMES: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
function scheduleTool(args: Record<string, unknown>, ctx: StudentContext, collected: AiSuggestion[]) {
  const major = majorFor(ctx, args.major_subject);
  // F&M students declare a major in the spring of sophomore year, so many show
  // "Undeclared". Ask before planning; enforced here so the AI can't skip it.
  if (!major && !ctx.majorUndecided && args.undecided !== true) {
    const upper = ctx.classYear === "JR" || ctx.classYear === "SR";
    return { not_built: "No major known yet.", ask_student_exactly: upper ? "What's your major?" : "What major are you thinking about? Not sure is fine." };
  }
  const language = typeof args.language_subject === "string" ? matchSubject(args.language_subject, LANGUAGE_SUBJECTS) : ctx.languageSubject ?? null;
  const needs = (ctx.needIds?.open ?? []).map(needFromId).filter((need) => !!need);
  const satisfiedTags = (ctx.needIds?.satisfied ?? []).flatMap((id) => needFromId(id)?.dist ?? []);
  const excludeDays = Array.isArray(args.exclude_days) ? args.exclude_days.map((day) => DAY_NAMES[String(day).slice(0, 3).toLowerCase()]).filter((day) => day !== undefined) : undefined;
  const result = buildSchedule({
    record: recordFor(ctx), openNeeds: needs, satisfiedTags, classYear: ctx.classYear, majorPrefix: major, languagePrefix: language,
    plan: ctx.plan, exclude: new Set(collected.map((item) => item.crn)),
    target: Math.min(Math.max(Number(args.total_courses) || 4, 1), 5),
    constraints: { excludeDays, earliest: toMinutes(args.earliest_start) ?? undefined, latest: toMinutes(args.latest_end) ?? undefined },
  });
  for (const pick of result.picks) collected.push({ crn: pick.course.crn, requirement: pick.label, reason: pick.reason });
  return {
    shown_to_student_as_cards: result.picks.map((pick) => ({ crn: pick.course.crn, course: `${pick.course.code}: ${pick.course.title}`, times: meeting(pick.course), role: pick.role, counts_toward: pick.label, why: pick.reason })),
    already_in_plan: ctx.plan.map((course) => course.code),
    major_used: major ?? "none (undeclared, no major chosen yet)",
    not_yet_eligible_in_major: result.blocked.map(({ course, reason }) => `${course.code} ${course.title}: ${reason}`),
    notes: result.notes,
  };
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
    case "get_course_details": return detailsTool(args, ctx);
    case "check_prerequisites": return prereqTool(args, ctx);
    case "build_schedule": return scheduleTool(args, ctx, collected);
    case "suggest_courses": return suggestTool(args, ctx, collected);
    default: return { error: `Unknown tool ${name}` };
  }
}

export function courseByCrn(crn: string) {
  return BY_CRN.get(crn);
}
