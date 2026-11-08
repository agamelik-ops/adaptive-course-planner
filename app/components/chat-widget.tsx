"use client";

import { useEffect, useRef, useState } from "react";
import {
  LANGUAGE_SUBJECTS, MAJOR_OPTIONS, matchSubject, summarizeAudit,
  type AuditSummary, type ClassYear,
} from "../lib/advisor";
import { makeRecord, parsePlacements } from "../lib/prereqs";
import { alternativeFor, buildSchedule, inferLanguage, majorPrefixFromProfile, type PickRole, type ScheduleInput } from "../lib/schedule";
import { courses as allCourses, meeting, overlaps, subjects, type Course } from "../lib/courses";
import { classYearFromAudit, parseAudit, readAudit, saveAudit, subscribeAudit, type DegreeAudit } from "../lib/degree-audit";
import { readPlan, restoreCourses, savePlan } from "../lib/saved-plan";

type Action =
  | { type: "year"; value: ClassYear }
  | { type: "language"; value: string | null }
  | { type: "major"; value: string | null }
  | { type: "plan" } | { type: "more" } | { type: "summary" } | { type: "accept-all" } | { type: "paste" };
type Chip = { label: string; action: Action };
// role: the slot this course fills in the schedule (major, language, requirement, elective).
// fromAi: picked by the AI outside the schedule builder, so Reject asks the student what they'd prefer.
type Suggestion = { id: number; label: string; role?: PickRole; course: Course; reason: string; status: "pending" | "accepted" | "rejected"; fromAi?: boolean };
type Message = { id: number; role: "assistant" | "user"; text: string; chips?: Chip[]; suggestionIds?: number[] };
type Prefs = { classYear?: ClassYear; languagePrefix?: string | null; majorPrefix?: string | null };

const YEARS: { label: string; value: ClassYear }[] = [
  { label: "First-year", value: "FR" }, { label: "Sophomore", value: "SO" },
  { label: "Junior", value: "JR" }, { label: "Senior", value: "SR" },
];
const MENU: Chip[] = [
  { label: "What do I still need?", action: { type: "summary" } },
  { label: "Build my plan", action: { type: "plan" } },
];

type AiSuggestionPayload = { crn: string; requirement: string; reason: string };
type AiResult =
  | { kind: "ok"; reply: string; suggestions: AiSuggestionPayload[] }
  | { kind: "not-configured" }
  | { kind: "error"; message: string };

// Free-form questions go to the server route (app/api/chat/route.ts), which calls
// the AI with real-catalog tools. Only requirement names/statuses, plan CRNs and
// preferences are sent, never names or student IDs.
async function askAI(history: Message[], context: Record<string, unknown>): Promise<AiResult> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })), context }),
    });
    if (response.status === 503) return { kind: "not-configured" };
    if (response.status === 429) return { kind: "error", message: "The assistant is busy right now. Give it a few seconds and try again." };
    if (!response.ok) return { kind: "error", message: "The AI is unavailable right now. Here’s what I can do without it." };
    const data = await response.json();
    return { kind: "ok", reply: String(data.reply ?? ""), suggestions: Array.isArray(data.suggestions) ? data.suggestions : [] };
  } catch {
    return { kind: "error", message: "I couldn’t reach the AI. Check your connection and try again." };
  }
}

function shortDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function summaryText(audit: DegreeAudit, summary: AuditSummary) {
  const lines = [`Here’s what your Degree Works audit (checked ${shortDate(audit.checkedAt)}) shows:`];
  if (audit.profile?.major) lines.push(`Major: ${audit.profile.major}${audit.profile.minor ? ` · Minor: ${audit.profile.minor}` : ""}`);
  if (audit.courses?.length) lines.push(`${audit.courses.filter((course) => course.status === "completed").length} completed course records · ${audit.courses.filter((course) => course.status === "in-progress").length} in progress or preregistered.`);
  if (summary.open.length) {
    lines.push("", "Still needed:");
    for (const need of summary.open) {
      lines.push(`• ${need.label}${need.kind === "major" && need.sources.some((s) => /not declared/i.test(s)) ? " — you haven’t declared a major yet" : ""}`);
    }
  } else {
    lines.push("", "No recognized requirements are marked incomplete in this import.");
  }
  if (summary.inProgress.length) lines.push("", `On track once your current classes finish: ${summary.inProgress.map((need) => need.label).join(", ")}.`);
  if (summary.complete.length) lines.push("", `Done: ${summary.complete.map((need) => need.label).join(", ")}.`);
  if (summary.open.some((need) => need.kind === "connections")) lines.push("", "Connections seminars aren’t in the Spring schedule, so check with your adviser about that one.");
  if (audit.partial) lines.push("", "This is a worksheet snapshot and may omit requirements or exceptions. Confirm your remaining requirements with your adviser.");
  return lines.join("\n");
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [audit, setAudit] = useState<DegreeAudit | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pasting, setPasting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const startedRef = useRef(false);
  // Which question the assistant last asked, so a typed answer goes to the right place.
  const awaitingRef = useRef<"year" | "major" | "language" | null>(null);

  const summary = audit ? summarizeAudit(audit) : null;

  // The subscription lives for the whole page, so it calls whatever the latest
  // handler is (kept in a ref) to see current preferences and conversation state.
  const onAuditRef = useRef<(incoming: DegreeAudit | null) => void>(() => {});
  useEffect(() => subscribeAudit((incoming) => onAuditRef.current(incoming)), []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function push(message: Omit<Message, "id">) {
    const id = nextId.current++;
    setMessages((current) => [...current, { ...message, id }]);
    return id;
  }
  function say(text: string, chips?: Chip[], suggestionIds?: number[]) {
    push({ role: "assistant", text, chips, suggestionIds });
  }

  function currentPlan() { return restoreCourses(readPlan()); }
  // What the student has done (completed + in progress counts by Spring) and placed into.
  function studentRecord(currentAudit = audit) {
    const taken = (currentAudit?.courses ?? []).filter((course) => course.status === "completed" || course.status === "in-progress").map((course) => course.code);
    return makeRecord(taken, parsePlacements(currentAudit?.profile?.languagePlacement, currentAudit?.profile?.mathPlacement));
  }

  function scheduleInput(nextPrefs: Prefs, currentAudit = audit, list = suggestions, extra: Partial<ScheduleInput> = {}): ScheduleInput {
    const sum = currentAudit ? summarizeAudit(currentAudit) : null;
    const pending = list.filter((item) => item.status === "pending").map((item) => item.course);
    return {
      record: studentRecord(currentAudit),
      openNeeds: sum?.open ?? [],
      satisfiedTags: sum ? [...sum.inProgress, ...sum.complete].flatMap((need) => need.dist ?? []) : [],
      classYear: nextPrefs.classYear,
      majorPrefix: nextPrefs.majorPrefix ?? null,
      languagePrefix: nextPrefs.languagePrefix ?? null,
      plan: [...currentPlan(), ...pending],
      exclude: new Set(list.filter((item) => item.status === "rejected").map((item) => item.course.crn)),
      ...extra,
    };
  }

  // ---- conversation flow -------------------------------------------------

  function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    const current = audit ?? readAudit();
    if (current) {
      setAudit(current);
      say(`Hi! I’m your planning assistant. ${summaryText(current, summarizeAudit(current))}`);
      askNext(applyAuditMajor(applyAuditYear(prefs, current), current), current);
    } else {
      say(
        "Hi! I’m your planning assistant. I don’t have your Degree Works audit yet.\n\nTo import it: open your audit at degreeworks.fandm.edu, click the F&M Course Planner extension, then “Import Degree Works.” Review the preview and confirm the import.\n\nNo extension? You can paste the audit data instead.",
        [{ label: "Paste audit data", action: { type: "paste" } }],
      );
    }
  }

  // Use the class level / expected graduation from Degree Works instead of asking.
  function applyAuditYear(base: Prefs, current: DegreeAudit): Prefs {
    const detected = classYearFromAudit(current);
    if (!detected || base.classYear) return base;
    const next = { ...base, classYear: detected };
    setPrefs(next);
    const label = YEARS.find((year) => year.value === detected)?.label.toLowerCase() ?? detected;
    const grad = current.profile?.graduationYear;
    say(`From Degree Works, I see you’re a ${label}${grad ? ` (expected graduation ${grad})` : ""}. If that’s not right, just tell me your class year.`);
    return next;
  }

  // Use the declared major from Degree Works. Majors are declared in the spring of
  // sophomore year, so first-years and fall sophomores usually show "Undeclared".
  function applyAuditMajor(base: Prefs, current: DegreeAudit): Prefs {
    if (base.majorPrefix !== undefined) return base;
    const declared = majorPrefixFromProfile(current.profile?.major);
    if (!declared) return base;
    const next = { ...base, majorPrefix: declared };
    setPrefs(next);
    say(`Your declared major is ${current.profile?.major}, so I’ll plan around the next courses in it.`);
    return next;
  }

  // A new audit arrived from the extension (possibly after the chat already started).
  function handleIncomingAudit(incoming: DegreeAudit | null) {
    setAudit(incoming);
    if (!incoming || !startedRef.current) return;
    say(`I just received your updated Degree Works audit.\n\n${summaryText(incoming, summarizeAudit(incoming))}`, MENU);
    const waitingForYear = !prefs.classYear;
    const next = applyAuditMajor(applyAuditYear(prefs, incoming), incoming);
    if (waitingForYear && next.classYear) askNext(next, incoming);
  }

  // Ask for what's missing (class year, then major, then language if we can't tell), then plan.
  function askNext(nextPrefs: Prefs, currentAudit = audit) {
    if (!currentAudit) return;
    const open = summarizeAudit(currentAudit).open;
    const upper = nextPrefs.classYear === "JR" || nextPrefs.classYear === "SR";
    if (!nextPrefs.classYear) {
      awaitingRef.current = "year";
      say("First, what’s your class year? Some sections are closed to certain years.",
        YEARS.map((year) => ({ label: year.label, action: { type: "year", value: year.value } })));
    } else if (nextPrefs.majorPrefix === undefined) {
      awaitingRef.current = "major";
      say(upper
        ? "Degree Works doesn’t show a declared major for you. What’s your major (or the one you’re planning to declare)? I’ll plan the next courses in it."
        : "At F&M you declare a major in the spring of sophomore year, so it’s normal not to have one yet. What are you thinking of majoring in? I’ll include the next courses for it, or tap “Not sure yet” and I’ll suggest intro courses to explore. (You can type any subject.)",
        [
          ...Object.entries(MAJOR_OPTIONS).map(([prefix, name]) => ({ label: name, action: { type: "major" as const, value: prefix } })),
          { label: "Not sure yet", action: { type: "major", value: null } },
        ]);
    } else if (open.some((need) => need.kind === "language") && nextPrefs.languagePrefix === undefined && !inferLanguage(studentRecord(currentAudit))) {
      awaitingRef.current = "language";
      say("You still need language study through the 201 level, and I can’t tell from Degree Works which language you’re in. Which one are you studying or planning to start?", [
        ...Object.entries(LANGUAGE_SUBJECTS).map(([prefix, name]) => ({ label: name, action: { type: "language" as const, value: prefix } })),
        { label: "Not sure", action: { type: "language", value: null } },
      ]);
    } else {
      awaitingRef.current = null;
      buildPlan(nextPrefs, false, currentAudit);
    }
  }

  // A full semester from the schedule builder (also used by the AI's build_schedule tool).
  function buildPlan(nextPrefs: Prefs, more = false, currentAudit = audit) {
    if (!currentAudit) return start();
    const base = scheduleInput(nextPrefs, currentAudit);
    const result = buildSchedule(more ? { ...base, target: base.plan.length + 2 } : base);
    const created: Suggestion[] = result.picks.map((pick) => ({ id: nextId.current++, label: pick.label, role: pick.role, course: pick.course, reason: pick.reason, status: "pending" }));
    setSuggestions((current) => [...current, ...created]);

    const lines: string[] = [];
    if (created.length) {
      const total = base.plan.length + created.length;
      lines.push(more ? "Here are a couple more options that fit your schedule:"
        : `Here’s a ${total}-course plan for Spring 2027 based on what you’ve taken${nextPrefs.majorPrefix ? ` and your ${subjects[nextPrefs.majorPrefix] ?? nextPrefs.majorPrefix} major` : ""}. Every course fits your prerequisites and schedule. Accept the ones you like and they’ll go on your calendar; reject one and I’ll swap in another.`);
    } else {
      lines.push(more ? "I don’t have more options that fit around your current plan." : "I couldn’t find courses that fit around your current plan.");
    }
    if (result.blocked.length) {
      lines.push(`Not yet eligible in ${subjects[nextPrefs.majorPrefix ?? ""] ?? "your major"}:\n${result.blocked.map(({ course, reason }) => `• ${course.code} ${course.title}: ${reason.replace(/^Needs /, "needs ")}`).join("\n")}`);
    }
    if (!nextPrefs.majorPrefix && majorStillOpen(currentAudit)) lines.push("Once you have a major in mind, tell me (e.g. “I’m thinking economics”) and I’ll rebuild the plan around it.");
    lines.push(...result.notes);
    say(lines.join("\n\n"),
      created.length ? [{ label: "Accept all", action: { type: "accept-all" } }, { label: "Suggest more", action: { type: "more" } }, MENU[0]] : MENU,
      created.map((item) => item.id));
  }
  function majorStillOpen(currentAudit: DegreeAudit) { return summarizeAudit(currentAudit).open.some((need) => need.kind === "major"); }

  function accept(id: number) {
    const item = suggestions.find((entry) => entry.id === id);
    if (!item || item.status !== "pending") return;
    const plan = currentPlan();
    const clash = plan.find((course) => overlaps(course, item.course));
    if (clash) {
      say(`${item.course.code} now overlaps with ${clash.code} in your plan, so I didn’t add it. Remove ${clash.code} first, or reject this one for an alternative.`);
      return;
    }
    if (!plan.some((course) => course.crn === item.course.crn)) savePlan([...plan, item.course]);
    setSuggestions((current) => current.map((entry) => entry.id === id ? { ...entry, status: "accepted" } : entry));
  }

  function acceptAll() {
    const pending = suggestions.filter((item) => item.status === "pending");
    let plan = currentPlan();
    const added: number[] = [];
    for (const item of pending) {
      if (plan.some((course) => overlaps(course, item.course))) continue;
      plan = [...plan, item.course];
      added.push(item.id);
    }
    savePlan(plan);
    setSuggestions((current) => current.map((entry) => added.includes(entry.id) ? { ...entry, status: "accepted" } : entry));
    say(added.length ? `Added ${added.length} course${added.length === 1 ? "" : "s"} to your calendar.` : "Nothing new to add. Everything is already decided or would overlap.", MENU);
  }

  function reject(id: number) {
    const item = suggestions.find((entry) => entry.id === id);
    if (!item || item.status !== "pending") return;
    const updated = suggestions.map((entry) => entry.id === id ? { ...entry, status: "rejected" as const } : entry);
    const sum = audit ? summarizeAudit(audit) : null;
    const need = sum?.open.find((entry) => entry.label === item.label);
    const alternative = item.role && !item.fromAi ? alternativeFor({ role: item.role, label: item.label, course: item.course }, scheduleInput(prefs, audit, updated), need) : null;
    if (alternative) {
      const next: Suggestion = { id: nextId.current++, label: alternative.label, role: alternative.role, course: alternative.course, reason: alternative.reason, status: "pending" };
      setSuggestions([...updated, next]);
      say(`No problem. Here’s another option for ${item.label}:`, undefined, [next.id]);
    } else {
      setSuggestions(updated);
      say(item.fromAi || !item.role
        ? `Okay, I’ve skipped ${item.course.code}. Tell me what you’d prefer instead (a different time, subject or professor) and I’ll look again.`
        : `That was the only option for ${item.label} that fits your prerequisites and schedule right now.`, MENU);
    }
  }

  function run(action: Action) {
    switch (action.type) {
      case "year": { const next = { ...prefs, classYear: action.value }; setPrefs(next); askNext(next); break; }
      case "language": { const next = { ...prefs, languagePrefix: action.value }; setPrefs(next); askNext(next); break; }
      case "major": { const next = { ...prefs, majorPrefix: action.value }; setPrefs(next); askNext(next); break; }
      case "plan": if (!prefs.classYear) askNext(prefs); else buildPlan(prefs); break;
      case "more": buildPlan(prefs, true); break;
      case "summary": if (audit && summary) say(summaryText(audit, summary), MENU); else start(); break;
      case "accept-all": acceptAll(); break;
      case "paste": setPasting(true); say("Paste the audit JSON below (the degreeAudit object from the extension) and press Enter."); break;
    }
  }

  function chooseChip(chip: Chip) {
    push({ role: "user", text: chip.label });
    run(chip.action);
  }

  async function sendText(text: string) {
    const value = text.trim();
    if (!value || thinking) return;
    push({ role: "user", text: value });
    setDraft("");

    if (pasting || value.startsWith("{")) {
      let parsed = null;
      try { parsed = parseAudit(JSON.parse(value)); } catch {}
      if (parsed) {
        setPasting(false);
        saveAudit(parsed);
        setAudit(parsed);
        say(`Got it! ${summaryText(parsed, summarizeAudit(parsed))}`);
        askNext(applyAuditYear(prefs, parsed), parsed);
      } else {
        say("That doesn’t look like a Degree Works audit. It should be JSON with a “requirements” list.");
      }
      return;
    }

    const lower = value.toLowerCase();
    const year = /first.?year|fresh|\bfr\b/.test(lower) ? "FR" : /soph|\bso\b/.test(lower) ? "SO" : /junior|\bjr\b/.test(lower) ? "JR" : /senior|\bsr\b/.test(lower) ? "SR" : null;
    const language = matchSubject(lower, LANGUAGE_SUBJECTS);
    const major = matchSubject(lower.replace(/i'?m |thinking|about|major(ing)? in|interested in|leaning toward/g, " "), { ...subjects, ...MAJOR_OPTIONS });

    const notSure = /not sure|no idea|undecided|don'?t know|exploring/.test(lower);
    const awaiting = awaitingRef.current;

    // Answers to the question the assistant just asked stay with the instant rules engine.
    if (audit && awaiting === "year" && year) return run({ type: "year", value: year });
    // Correcting a detected class year, e.g. "actually I'm a sophomore".
    if (year && prefs.classYear && year !== prefs.classYear && /i'?m an?\b|i am an?\b|actually|class year/.test(lower)) {
      setPrefs({ ...prefs, classYear: year });
      return say(`Got it, I’ll plan for a ${YEARS.find((item) => item.value === year)?.label.toLowerCase()} from now on.`, MENU);
    }
    if (audit && awaiting === "major" && (major || notSure)) return run({ type: "major", value: notSure ? null : major });
    if (audit && awaiting === "language" && (language || notSure)) return run({ type: "language", value: notSure ? null : language });
    // Naming a major later ("actually I'm thinking economics") updates the plan's focus.
    if (audit && major && prefs.classYear && /major|thinking|interested|leaning|switch|instead/.test(lower)) {
      const next = { ...prefs, majorPrefix: major };
      setPrefs(next);
      say(`Got it, I’ll plan around ${subjects[major] ?? major}.`);
      return buildPlan(next);
    }

    // Everything else goes to the AI, which can search the real catalog.
    setThinking(true);
    const result = await askAI([...messages, { id: -1, role: "user", text: value }], aiContext());
    setThinking(false);
    if (result.kind === "ok") return showAiReply(result.reply, result.suggestions);
    if (result.kind === "error") say(result.message);

    // AI not set up or unavailable: fall back to the rules engine.
    if (/still need|what.*need|left|missing|requirement|remaining|audit/.test(lower)) return run({ type: "summary" });
    if (/more|another|other option|else/.test(lower)) return run({ type: "more" });
    if (/plan|recommend|suggest|outline|schedule|what should i take/.test(lower)) return run({ type: "plan" });
    if (result.kind === "not-configured") {
      say("I can’t answer open-ended questions until the AI is set up. For now I can show what you still need and build a plan from it.", audit ? MENU : undefined);
    }
  }

  function aiContext(): Record<string, unknown> {
    return {
      planCrns: currentPlan().map((course) => course.crn),
      classYear: prefs.classYear,
      expectedGraduation: audit?.profile?.graduationYear,
      language: prefs.languagePrefix ? LANGUAGE_SUBJECTS[prefs.languagePrefix] : undefined,
      major: prefs.majorPrefix ? (MAJOR_OPTIONS[prefs.majorPrefix] ?? subjects[prefs.majorPrefix] ?? prefs.majorPrefix) : undefined,
      // From Degree Works. Course codes only: no grades, terms or titles.
      declaredMajor: audit?.profile?.major,
      languagePlacement: audit?.profile?.languagePlacement,
      mathPlacement: audit?.profile?.mathPlacement,
      takenCodes: (audit?.courses ?? []).filter((course) => course.status === "completed" || course.status === "in-progress").map((course) => course.code),
      majorSubject: prefs.majorPrefix ?? undefined,
      languageSubject: prefs.languagePrefix ?? undefined,
      needIds: summary ? { open: summary.open.map((need) => need.id), satisfied: [...summary.inProgress, ...summary.complete].map((need) => need.id) } : undefined,
      audit: summary ? {
        open: summary.open.map((need) => need.label),
        inProgress: summary.inProgress.map((need) => need.label),
        complete: summary.complete.map((need) => need.label),
      } : undefined,
    };
  }

  function showAiReply(reply: string, picks: AiSuggestionPayload[]) {
    const taken = new Set([...currentPlan(), ...suggestions.filter((item) => item.status !== "rejected").map((item) => item.course)].map((course) => course.crn));
    const created: Suggestion[] = [];
    for (const pick of picks) {
      const course = allCourses.find((item) => item.crn === pick.crn);
      if (!course || taken.has(course.crn)) continue;
      taken.add(course.crn);
      created.push({ id: nextId.current++, course, label: pick.requirement || "Suggested", reason: pick.reason || "Suggested by the assistant.", status: "pending", fromAi: true });
    }
    if (created.length) setSuggestions((current) => [...current, ...created]);
    say(reply, created.length ? [{ label: "Accept all", action: { type: "accept-all" } }, ...MENU] : (audit ? MENU : undefined), created.map((item) => item.id));
  }

  // ---- rendering ---------------------------------------------------------

  // Point the audit subscription at the latest handler (declared above).
  useEffect(() => { onAuditRef.current = handleIncomingAudit; });

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Course planning assistant">
          <header className="chat-header">
            <div className="chat-avatar" aria-hidden="true">✦</div>
            <div>
              <strong>Planning Assistant</strong>
              <span>{audit ? "Degree Works linked · Saved academic history" : "Spring 2027 course advisor"}</span>
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`chat-row ${message.role}`}>
                <div className={`chat-bubble ${message.role}`}>{message.text}</div>
                {message.suggestionIds?.map((sid) => {
                  const item = suggestions.find((entry) => entry.id === sid);
                  if (!item) return null;
                  return (
                    <article key={sid} className={`suggestion-card ${item.status}`}>
                      <div className="suggestion-top">
                        <strong>{item.course.code}{item.course.section ? ` ${item.course.section}` : ""}</strong>
                        <span className="suggestion-need">{item.label}</span>
                      </div>
                      <p className="suggestion-title">{item.course.title}</p>
                      <p className="suggestion-meta">{meeting(item.course)}</p>
                      <p className="suggestion-meta">CRN {item.course.crn}{item.course.instructors.length ? ` · ${item.course.instructors.join(", ")}` : ""}</p>
                      <p className="suggestion-reason">{item.reason}</p>
                      {item.course.prereq && <p className="suggestion-prereq">Prerequisite: {item.course.prereq}</p>}
                      {item.status === "pending" ? (
                        <div className="suggestion-actions">
                          <button className="accept" onClick={() => accept(sid)}>Accept</button>
                          <button className="reject" onClick={() => reject(sid)}>Reject</button>
                        </div>
                      ) : (
                        <p className={`suggestion-status ${item.status}`}>{item.status === "accepted" ? "✓ Added to your plan" : "Rejected"}</p>
                      )}
                    </article>
                  );
                })}
                {message.id === lastAssistant && message.chips && !thinking && (
                  <div className="chat-suggestions">
                    {message.chips.map((chip) => (
                      <button key={chip.label} onClick={() => chooseChip(chip)}>{chip.label}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div className="chat-bubble assistant chat-typing" aria-label="Assistant is typing">
                <span /><span /><span />
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(event) => { event.preventDefault(); sendText(draft); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={pasting ? "Paste audit JSON…" : "Ask about your requirements or plan…"}
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendText(draft);
                }
              }}
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || thinking}>↑</button>
          </form>
        </section>
      )}

      <button
        className={`chat-launcher${open ? " is-open" : ""}${audit && !started ? " has-audit" : ""}`}
        aria-label={open ? "Close planning assistant" : "Open planning assistant"}
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value); start(); }}
      >
        {open ? "×" : (
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
          </svg>
        )}
      </button>
    </div>
  );
}
