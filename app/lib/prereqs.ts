// Prerequisite checking against a student's record.
//
// The registrar's prerequisite text looks like:
//   "(CPS112 OR PLACEMENT IN 222) AND (MAT 109 OR MAT 110 OR PLACEMENT IN 110)"
//   "MAT 109 (MAY BE TAKEN CONCURRENTLY) OR MAT 110"
//   "(BIO 101 OR PERMISSION ) AND BIO 102"
//   "Two prior philosophy courses" / "SOC 100 plus one other SOC course"
// We parse it into AND/OR logic and evaluate with three values: met, unmet, or
// unknown (permission-only, unparsed wording, or a placement we don't know).

import type { Course } from "./courses";

export type PrereqStatus = "met" | "unmet" | "unknown";
export type PrereqResult = { status: PrereqStatus; reason: string };

export type StudentRecord = {
  taken: Set<string>; // completed or in-progress course codes, e.g. "CPS 111" (done by Spring)
  concurrent: Set<string>; // courses planned for the same semester
  placements: Record<string, number>; // e.g. { SPA: 101, FRN: 102, MAT: 110 }
};

const LANGUAGE_NAMES: Record<string, string> = {
  chinese: "CHN", french: "FRN", german: "GER", greek: "GRK", italian: "ITA",
  japanese: "JPN", latin: "LAT", russian: "RUS", spanish: "SPA", math: "MAT", mathematics: "MAT",
};

/** "French Placement 102, Spanish Placement 101" + "Math Placement 110" -> { FRN: 102, SPA: 101, MAT: 110 } */
export function parsePlacements(...texts: (string | undefined)[]): Record<string, number> {
  const placements: Record<string, number> = {};
  for (const text of texts) {
    for (const match of (text ?? "").matchAll(/([a-z]+)\s+placement\s+(\d{3})/gi)) {
      const prefix = LANGUAGE_NAMES[match[1].toLowerCase()];
      if (prefix) placements[prefix] = Math.max(placements[prefix] ?? 0, Number(match[2]));
    }
  }
  return placements;
}

export function makeRecord(takenCodes: Iterable<string>, placements: Record<string, number> = {}, concurrent: Iterable<string> = []): StudentRecord {
  const norm = (code: string) => code.toUpperCase().replace(/^([A-Z]{2,4})\s*(\d)/, "$1 $2").trim();
  return { taken: new Set([...takenCodes].map(norm)), concurrent: new Set([...concurrent].map(norm)), placements };
}

type Value = boolean | null; // null = unknown
const and = (a: Value, b: Value): Value => (a === false || b === false ? false : a === null || b === null ? null : true);
const or = (a: Value, b: Value): Value => (a === true || b === true ? true : a === null || b === null ? null : false);

const countIn = (record: StudentRecord, subject: string, min = 0, max = 999) =>
  [...record.taken].filter((code) => {
    const [prefix, num] = code.split(" ");
    const n = parseInt(num, 10);
    return prefix === subject && n >= min && n <= max;
  }).length;

// Written-out rules that aren't AND/OR lists of course codes.
function specialRule(text: string, course: Course, record: StudentRecord): Value | undefined {
  const t = text.toLowerCase().trim();
  if (/^two prior philosophy courses$/.test(t)) return countIn(record, "PHI") >= 2;
  let m = t.match(/^one ([a-z]{3}) course$/);
  if (m) return countIn(record, m[1].toUpperCase()) >= 1;
  m = t.match(/^one ([a-z]{3}) or one ([a-z]{3}) course$/);
  if (m) return countIn(record, m[1].toUpperCase()) >= 1 || countIn(record, m[2].toUpperCase()) >= 1;
  m = t.match(/^([a-z]{3}) (\d{3}) plus one other ([a-z]{3}) course$/);
  if (m) return record.taken.has(`${m[1].toUpperCase()} ${m[2]}`) && countIn(record, m[3].toUpperCase()) >= 2;
  if (/courses? at 221-250 level/.test(t)) {
    const subject = course.code.split(" ")[0];
    if (countIn(record, subject, 221, 250) >= 2 || (record.placements[subject] ?? 0) >= 321) return true;
    return countIn(record, subject, 221, 250) === 1 ? null : false; // the "advanced mid placement" path can't be verified
  }
  return undefined;
}

type Token = { kind: "(" | ")" | "and" | "or" } | { kind: "atom"; value: Value; label: string };

function tokenize(text: string, course: Course, record: StudentRecord): Token[] {
  const source = text.toUpperCase().replace(/([A-Z]{2,4})\s?(\d{3}[A-Z]?)\s*\(MAY BE TAKEN CONCURRENTLY\)/g, "$1$2~C");
  const raw = source.match(/\(|\)|\bAND\b|\bOR\b|[A-Z]{2,4}\s?\d{3}[A-Z]?(?:~C)?|PLACEMENT IN \d{3}|\bPERMISSION\b|[^\s()]+/g) ?? [];
  const tokens: Token[] = [];
  let lastSubject = course.code.split(" ")[0];
  for (const piece of raw) {
    if (piece === "(" || piece === ")") { tokens.push({ kind: piece }); continue; }
    if (piece === "AND" || piece === "OR") { tokens.push({ kind: piece.toLowerCase() as "and" | "or" }); continue; }
    const courseMatch = piece.match(/^([A-Z]{2,4})\s?(\d{3}[A-Z]?)(~C)?$/);
    if (courseMatch) {
      const code = `${courseMatch[1]} ${courseMatch[2]}`;
      lastSubject = courseMatch[1];
      const ok = record.taken.has(code) || (!!courseMatch[3] && record.concurrent.has(code));
      tokens.push({ kind: "atom", value: ok, label: code });
      continue;
    }
    const placement = piece.match(/^PLACEMENT IN (\d{3})$/);
    if (placement) {
      // "PLACEMENT IN 110" refers to the subject of the nearest course code before it.
      // If we have the student's placements but none for this subject, they didn't place in;
      // if we have no placement data at all, we can't tell.
      const level = record.placements[lastSubject];
      const value = level !== undefined ? level >= Number(placement[1]) : Object.keys(record.placements).length ? false : null;
      tokens.push({ kind: "atom", value, label: `${lastSubject} placement ${placement[1]}+` });
      continue;
    }
    if (piece === "PERMISSION") { tokens.push({ kind: "atom", value: null, label: "instructor permission" }); continue; }
    // Unrecognized words ("BIOP FOR MIN. SCORE OF Y", "ADVANCED MID"): merge into one unknown atom.
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === "atom" && previous.value === null && previous.label.startsWith("~")) previous.label += ` ${piece}`;
    else tokens.push({ kind: "atom", value: null, label: `~${piece}`, subject: lastSubject } as Token);
  }
  // "PLACEMENT IN ADVANCED LOW" / "ADVANCED MID": placement above the 202 level in that subject.
  for (const token of tokens) {
    if (token.kind !== "atom" || token.value !== null || !/ADVANCED/.test(token.label)) continue;
    const subject = (token as { subject?: string }).subject ?? lastSubject;
    const level = record.placements[subject];
    token.value = level !== undefined ? level >= 220 : Object.keys(record.placements).length ? false : null;
  }
  return tokens;
}

function parse(tokens: Token[]): Value {
  let index = 0;
  const factor = (): Value => {
    const token = tokens[index++];
    if (!token) return null;
    if (token.kind === "(") {
      const value = expr();
      if (tokens[index]?.kind === ")") index++;
      return value;
    }
    if (token.kind === "atom") return token.value;
    return null;
  };
  const term = (): Value => {
    let value = factor();
    while (tokens[index]?.kind === "and") { index++; value = and(value, factor()); }
    return value;
  };
  const expr = (): Value => {
    let value = term();
    while (tokens[index]?.kind === "or") { index++; value = or(value, term()); }
    return value;
  };
  return expr();
}

function evaluate(text: string, course: Course, record: StudentRecord): Value {
  // "A; OR B; OR C" is a list of alternatives.
  let value: Value = false;
  for (const alternative of text.split(/;\s*OR\s+/i)) {
    const special = specialRule(alternative, course, record);
    value = or(value, special !== undefined ? special : parse(tokenize(alternative, course, record)));
  }
  return value;
}

// "(A OR B) AND (C OR D)" -> ["(A OR B)", "(C OR D)"]: the AND-ed parts at the outer level.
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  const upper = text.toUpperCase();
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && upper.startsWith("AND", i) && /[\s)]/.test(text[i - 1] ?? "") && /[\s(]/.test(text[i + 3] ?? "")) {
      parts.push(text.slice(start, i));
      start = i + 3;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// True for "(A OR B)" but not "(A) OR (B)".
function wrappedInParens(text: string) {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0 && i < text.length - 1) return false;
  }
  return true;
}

// "(CPS 237 OR MAT 237 )" -> "CPS 237 or MAT 237"
function readable(part: string) {
  let text = part.trim();
  if (wrappedInParens(text)) text = text.slice(1, -1);
  return text.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim()
    .replace(/([A-Z]{2,4})(\d{3})/g, "$1 $2")
    .replace(/\(MAY BE TAKEN CONCURRENTLY\)/gi, "(can be taken at the same time)")
    .replace(/PLACEMENT IN (\d{3})/gi, "placement into $1")
    .replace(/\bOR\b/g, "or").replace(/\bAND\b/g, "and");
}

/** The parts of a prerequisite the student is still missing, in plain words, e.g. ["CPS 237 or MAT 237"]. */
export function missingParts(course: Course, record: StudentRecord): string[] {
  const text = course.prereq?.trim();
  if (!text || /;\s*OR\s+/i.test(text)) return [];
  return topLevelParts(text).filter((part) => evaluate(part, course, record) === false).map(readable);
}

/** Can this student take `course` in Spring, given what they've taken and planned? */
export function checkPrereq(course: Course, record: StudentRecord): PrereqResult {
  const text = course.prereq?.trim();
  if (!text) return { status: "met", reason: "No prerequisites." };
  const value = evaluate(text, course, record);
  if (value === true) return { status: "met", reason: `Prerequisite met (${text}).` };
  if (value === false) {
    const missing = missingParts(course, record);
    return { status: "unmet", reason: `Needs ${missing.length ? missing.join(" and ") : text}.` };
  }
  return { status: "unknown", reason: /PERMISSION/i.test(text) ? `May need instructor permission (${text}).` : `Check the prerequisite: ${text}.` };
}
