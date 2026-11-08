// Builds a full Spring schedule (default 4 courses) from a student's record.
// Used by both the chat's "Build my plan" and the AI's build_schedule tool, so
// the two always agree. Every pick is checked for prerequisites, class-year
// restrictions, permission, time conflicts, repeats and cross-listed duplicates.

import { courses, overlaps, subjects, type Course } from "./courses";
import { LANGUAGE_SUBJECTS, matchSubject, numberOf, prefixOf, type ClassYear, type Need } from "./advisor";
import { checkPrereq, type PrereqStatus, type StudentRecord } from "./prereqs";

export type PickRole = "major" | "support" | "language" | "requirement" | "elective";
export type SchedulePick = { course: Course; role: PickRole; label: string; reason: string; prereq: PrereqStatus };
export type BlockedCourse = { course: Course; reason: string };
export type ScheduleConstraints = { excludeDays?: number[]; earliest?: number; latest?: number };
export type ScheduleInput = {
  record: StudentRecord;
  openNeeds: Need[]; // incomplete Degree Works requirements
  satisfiedTags?: string[]; // gen-ed tags already complete or in progress
  classYear?: ClassYear;
  majorPrefix?: string | null;
  languagePrefix?: string | null;
  plan: Course[]; // courses already in the student's plan
  exclude?: Set<string>; // CRNs the student rejected
  target?: number; // total courses wanted, default 4
  constraints?: ScheduleConstraints;
};
export type ScheduleResult = { picks: SchedulePick[]; blocked: BlockedCourse[]; notes: string[] };

// Subjects commonly required alongside a major (e.g. math for computer science).
export const MAJOR_SUPPORT: Record<string, string[]> = {
  CPS: ["MAT"], DSC: ["MAT", "CPS"], ECO: ["MAT"], BIO: ["CHM"], CHM: ["MAT", "PHY"],
  PHY: ["MAT"], MAT: ["CPS"], BOS: ["ECO"], ENE: ["CHM"],
};

type Request = { role: PickRole; label: string; need?: Need; subjects?: string[] };

const subjectName = (prefix: string) => subjects[prefix] ?? LANGUAGE_SUBJECTS[prefix] ?? prefix;
const signature = (course: Course) => `${course.title}|${JSON.stringify(course.meetings)}`; // cross-listed twins share this
const isHalfCredit = (course: Course) => /half credit|\.5 credit/i.test(course.description ?? "");
const isLabOnly = (course: Course) => /^lab$/i.test(course.title.trim());
const hasSeparateLab = (course: Course) => courses.some((other) => other.code === course.code && isLabOnly(other));

/** Degree Works major text ("Computer Science", "Undeclared") -> subject prefix or null. */
export function majorPrefixFromProfile(major?: string | null): string | null {
  if (!major || /undeclared|none|^n\/?a$/i.test(major.trim())) return null;
  return matchSubject(major.split(/[,/;]| and /i)[0], subjects);
}

/** Highest level the student has reached in a language (placement or taken course + 1). */
export function languageLevel(record: StudentRecord, prefix: string) {
  const taken = [...record.taken].filter((code) => code.startsWith(`${prefix} `)).map((code) => parseInt(code.split(" ")[1], 10) + 1);
  return Math.max(record.placements[prefix] ?? 0, ...taken, 0);
}

/** The language the student is most likely continuing, from placements and courses taken. */
export function inferLanguage(record: StudentRecord): string | null {
  let best: string | null = null;
  let bestLevel = 0;
  for (const prefix of Object.keys(LANGUAGE_SUBJECTS)) {
    const level = languageLevel(record, prefix);
    if (level > bestLevel) { best = prefix; bestLevel = level; }
  }
  return best;
}

function fitsConstraints(course: Course, constraints: ScheduleConstraints = {}) {
  return course.meetings.every((item) =>
    !item.days.some((day) => constraints.excludeDays?.includes(day)) &&
    (constraints.earliest === undefined || item.start >= constraints.earliest) &&
    (constraints.latest === undefined || item.end <= constraints.latest));
}

function candidates(request: Request, input: ScheduleInput, chosen: Course[]): { course: Course; score: number; reason: string; prereq: PrereqStatus }[] {
  const { record, classYear } = input;
  const chosenCodes = new Set(chosen.map((course) => course.code));
  const chosenSigs = new Set(chosen.map(signature));
  const withConcurrent = { ...record, concurrent: new Set([...record.concurrent, ...chosenCodes]) };
  const upper = classYear === "JR" || classYear === "SR";
  const majorSubjects = new Set([input.majorPrefix ?? "", ...(MAJOR_SUPPORT[input.majorPrefix ?? ""] ?? [])].filter(Boolean));
  const satisfied = new Set(input.satisfiedTags ?? []);
  // Only gen-ed areas the student's audit actually lists as unfinished.
  const openTags = new Set(input.openNeeds.flatMap((need) => need.dist ?? []).filter((tag) => !satisfied.has(tag)));
  const results = [];

  for (const course of courses) {
    const level = numberOf(course);
    const prefix = prefixOf(course);
    if (!course.meetings.length || course.permission || isLabOnly(course) || isHalfCredit(course)) continue;
    if (classYear && course.closedTo.includes(classYear)) continue;
    if (record.taken.has(course.code) || chosenCodes.has(course.code) || chosenSigs.has(signature(course))) continue;
    if (input.exclude?.has(course.crn)) continue;
    if (chosen.some((other) => overlaps(course, other)) || !fitsConstraints(course, input.constraints)) continue;
    if (level >= 400 && !(upper && request.role === "major")) continue; // seminars/capstones only for upper-level majors
    const placed = record.placements[prefix];
    if (placed && level < placed && level < 200) continue; // placed past this intro level (e.g. Math 110 placement skips MAT 109)
    const prereq = checkPrereq(course, withConcurrent);
    if (prereq.status === "unmet" || (prereq.status === "unknown" && /permission/i.test(prereq.reason))) continue;

    let score = prereq.status === "met" ? 0 : -5;
    let reason = "";
    const takenRefs = [...record.taken].filter((code) => course.prereq.toUpperCase().replace(/([A-Z]{2,4})(\d)/g, "$1 $2").includes(code));
    const sameSubjectTaken = [...record.taken].filter((code) => code.startsWith(`${prefix} `));

    switch (request.role) {
      case "major":
      case "support": {
        if (!request.subjects?.includes(prefix)) continue;
        if (takenRefs.length) { score += 6; reason = `Next step in ${subjectName(prefix)}: builds on ${takenRefs.join(", ")}.`; }
        else if (!course.prereq && !sameSubjectTaken.length) { score += 4; reason = `Entry point into ${subjectName(prefix)}.`; }
        else { score += 1; reason = `Builds toward the ${subjectName(prefix)} ${request.role === "major" ? "major" : "requirements for your major"}.`; }
        if (!upper && level < 200) score += 1;
        score -= level / 100;
        if (request.role === "support") reason = `${reason} Commonly required for ${subjectName(input.majorPrefix ?? "")} majors.`;
        break;
      }
      case "language": {
        const target = request.subjects?.[0];
        if (prefix !== target) continue;
        if (!(course.dist.includes("LANG") || course.prereq.toUpperCase().includes(target) || level < 200)) continue; // skip culture courses taught in English
        if (prereq.status !== "met") continue; // language level must be certain, not a guess
        const current = languageLevel(record, target);
        if (current && level < current) continue; // never step backwards
        score -= level / 100; // the lowest eligible level is the next one in the sequence
        reason = level >= 201
          ? `Counts toward your language requirement (${subjectName(target)} at the 201+ level).`
          : `Next step toward the 201-level language requirement (${subjectName(target)} ${level}).`;
        break;
      }
      case "requirement": {
        const tags = request.need?.dist ?? [];
        if (!tags.some((tag) => course.dist.includes(tag))) continue;
        const bonusTags = course.dist.filter((tag) => openTags.has(tag) && !tags.includes(tag));
        score += bonusTags.length + (course.prereq ? 0 : 1) + (majorSubjects.has(prefix) ? 2 : 0) - level / 100;
        reason = `Counts toward ${request.label}${bonusTags.length ? ` (also ${bonusTags.join(", ")})` : ""}.`;
        break;
      }
      case "elective": {
        if (level > (upper ? 399 : 299)) continue;
        const covers = course.dist.filter((tag) => openTags.has(tag));
        const chosenSubjects = new Set(chosen.map(prefixOf));
        // Undeclared students: favor intro courses that let them try out a possible major.
        const exploring = !input.majorPrefix && level < 200 && /^(intro|introduction|elementary|principles|fundamentals)|\bintro\b/i.test(course.title);
        score += (majorSubjects.has(prefix) ? 3 : 0) + 2 * covers.length + (exploring ? 2 : 0) + (course.prereq ? 0 : 1) - (chosenSubjects.has(prefix) ? 4 : 0) - level / 100;
        reason = majorSubjects.has(prefix) ? `Elective in ${subjectName(prefix)}, related to your major.`
          : covers.length ? `Elective that also counts toward ${covers.join(", ")}.`
          : exploring ? `Intro course to explore ${subjectName(prefix)} as a possible major.`
          : `Open elective in ${subjectName(prefix)}.`;
        break;
      }
    }
    if (hasSeparateLab(course)) reason += " Register for a lab section too.";
    if (prereq.status === "unknown") reason += ` ${prereq.reason}`;
    results.push({ course, score, reason, prereq: prereq.status });
  }
  return results.sort((a, b) => b.score - a.score || numberOf(a.course) - numberOf(b.course) || a.course.crn.localeCompare(b.course.crn));
}

function requestsFor(input: ScheduleInput): { requests: Request[]; notes: string[] } {
  const notes: string[] = [];
  const requests: Request[] = [];
  const upper = input.classYear === "JR" || input.classYear === "SR";
  const major = input.majorPrefix;
  const majorLabel = major ? `${subjectName(major)} major` : "";
  const support = major ? MAJOR_SUPPORT[major] ?? [] : [];

  if (major) requests.push({ role: "major", label: majorLabel, subjects: [major] });
  if (input.openNeeds.some((need) => need.kind === "language")) {
    const language = input.languagePrefix ?? inferLanguage(input.record);
    if (language) requests.push({ role: "language", label: "Language", subjects: [language] });
    else notes.push("Tell me which language you're studying (or plan to start) and I'll add the right course for the language requirement.");
  }
  for (const need of input.openNeeds) if (need.kind === "dist") requests.push({ role: "requirement", label: need.label, need });
  if (major) {
    if (upper) requests.push({ role: "major", label: majorLabel, subjects: [major] });
    else if (support.length) requests.push({ role: "support", label: `${subjectName(support[0])} for ${majorLabel}`, subjects: support });
    else requests.push({ role: "major", label: majorLabel, subjects: [major] });
  }
  if (input.openNeeds.some((need) => need.kind === "connections")) notes.push("Connections seminars aren't in the Spring schedule, so check with your adviser about that requirement.");
  return { requests, notes };
}

/** A full schedule: picks in priority order, courses in the major you can't take yet, and notes. */
export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const target = input.target ?? 4;
  const chosen = [...input.plan];
  const picks: SchedulePick[] = [];
  const { requests, notes } = requestsFor(input);
  const slots = Math.max(0, target - input.plan.length);

  if (!slots) notes.push(`Your plan already has ${input.plan.length} courses.`);
  for (const request of requests) {
    if (picks.length >= slots) break;
    const [best] = candidates(request, input, chosen);
    if (!best) {
      if (request.role === "language") {
        const prefix = request.subjects![0];
        const level = languageLevel(input.record, prefix);
        notes.push(`No ${subjectName(prefix)} course at your level${level ? ` (${prefix} ${level})` : ""} fits this spring. Some levels are only taught in the fall, so check with the language department.`);
      } else if (request.role === "major" && !picks.some((pick) => pick.role === "major")) {
        notes.push(`No ${request.label} course you're eligible for fits around your plan this spring.`);
      }
      continue;
    }
    picks.push({ course: best.course, role: request.role, label: request.label, reason: best.reason, prereq: best.prereq });
    chosen.push(best.course);
  }
  // Fill the remaining slots with electives.
  while (picks.length < slots) {
    const [best] = candidates({ role: "elective", label: "Elective" }, input, chosen);
    if (!best) { notes.push("I couldn't find more courses that fit around your schedule."); break; }
    picks.push({ course: best.course, role: "elective", label: "Elective", reason: best.reason, prereq: best.prereq });
    chosen.push(best.course);
  }

  return { picks, blocked: blockedInMajor(input), notes };
}

/** Major courses offered this spring that the student can't take yet, with what's missing. */
export function blockedInMajor(input: ScheduleInput, limit = 3): BlockedCourse[] {
  if (!input.majorPrefix) return [];
  const seen = new Set<string>();
  return courses
    .filter((course) => prefixOf(course) === input.majorPrefix && !isLabOnly(course) && !input.record.taken.has(course.code) && numberOf(course) < 400)
    .map((course) => ({ course, result: checkPrereq(course, input.record) }))
    .filter(({ course, result }) => result.status === "unmet" && !seen.has(course.code) && seen.add(course.code))
    .sort((a, b) => numberOf(a.course) - numberOf(b.course))
    .slice(0, limit)
    .map(({ course, result }) => ({ course, reason: result.reason }));
}

/** Another course for the same slot after the student rejects one. */
export function alternativeFor(pick: Pick<SchedulePick, "role" | "label" | "course">, input: ScheduleInput, need?: Need): SchedulePick | null {
  const request: Request = pick.role === "requirement"
    ? { role: "requirement", label: pick.label, need }
    : pick.role === "language" ? { role: "language", label: pick.label, subjects: [prefixOf(pick.course)] }
    : pick.role === "major" || pick.role === "support" ? { role: pick.role, label: pick.label, subjects: pick.role === "major" ? [input.majorPrefix ?? prefixOf(pick.course)] : MAJOR_SUPPORT[input.majorPrefix ?? ""] ?? [prefixOf(pick.course)] }
    : { role: "elective", label: "Elective" };
  const [best] = candidates(request, input, input.plan);
  return best ? { course: best.course, role: request.role, label: request.label, reason: best.reason, prereq: best.prereq } : null;
}
