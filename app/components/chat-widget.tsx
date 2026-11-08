"use client";

import { useEffect, useRef, useState } from "react";
import {
  LANGUAGE_SUBJECTS, MAJOR_OPTIONS, matchSubject, reasonFor, recommend, summarizeAudit,
  type AdvisorContext, type AuditSummary, type ClassYear, type Need,
} from "../lib/advisor";
import { meeting, overlaps, subjects, type Course } from "../lib/courses";
import { parseAudit, readAudit, saveAudit, subscribeAudit, type DegreeAudit } from "../lib/degree-audit";
import { readPlan, restoreCourses, savePlan } from "../lib/saved-plan";

type Action =
  | { type: "year"; value: ClassYear }
  | { type: "language"; value: string | null }
  | { type: "major"; value: string | null }
  | { type: "plan" } | { type: "more" } | { type: "summary" } | { type: "accept-all" } | { type: "paste" };
type Chip = { label: string; action: Action };
type Suggestion = { id: number; need: Need; course: Course; reason: string; status: "pending" | "accepted" | "rejected" };
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

// TODO(AI): free-form questions the rules engine doesn't understand end up here.
// Swap this for a call to the AI backend, passing the conversation plus the
// audit summary and the student's plan so answers stay grounded in real data.
async function getReply(history: Message[]): Promise<string> {
  void history;
  return "I can’t answer open-ended questions yet — the AI part is coming soon. For now I can show what you still need for your degree and build a plan from it.";
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

  const summary = audit ? summarizeAudit(audit) : null;

  useEffect(() => subscribeAudit((incoming) => {
    setAudit(incoming);
    if (incoming && startedRef.current) {
      const id = nextId.current++;
      const text = `I just received your updated Degree Works audit.\n\n${summaryText(incoming, summarizeAudit(incoming))}`;
      setMessages((current) => [...current, { id, role: "assistant", text, chips: MENU }]);
    }
  }), []);

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
  function context(nextPrefs: Prefs, list = suggestions): AdvisorContext {
    return {
      plan: currentPlan(),
      academicCourses: audit?.courses,
      pending: list.filter((item) => item.status === "pending").map((item) => item.course),
      rejected: new Set(list.filter((item) => item.status === "rejected").map((item) => item.course.crn)),
      classYear: nextPrefs.classYear,
      languagePrefix: nextPrefs.languagePrefix ?? undefined,
      majorPrefix: nextPrefs.majorPrefix ?? undefined,
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
      askNext({}, current);
    } else {
      say(
        "Hi! I’m your planning assistant. I don’t have your Degree Works audit yet.\n\nTo import it: open your audit at degreeworks.fandm.edu, click the F&M Course Planner extension, then “Import Degree Works.” Review the preview and confirm the import.\n\nNo extension? You can paste the audit data instead.",
        [{ label: "Paste audit data", action: { type: "paste" } }],
      );
    }
  }

  function askNext(nextPrefs: Prefs, currentAudit = audit) {
    if (!currentAudit) return;
    const open = summarizeAudit(currentAudit).open;
    if (!nextPrefs.classYear) {
      say("First, what’s your class year? Some sections are closed to certain years.",
        YEARS.map((year) => ({ label: year.label, action: { type: "year", value: year.value } })));
    } else if (open.some((need) => need.kind === "language") && nextPrefs.languagePrefix === undefined) {
      const offered = Object.entries(LANGUAGE_SUBJECTS).filter(([prefix]) =>
        recommend({ id: "language", label: "", kind: "language", status: "incomplete", sources: [] }, { ...context(nextPrefs), languagePrefix: prefix }, 1).length);
      say("You still need a language course at the 201 level or higher. Which language are you studying?", [
        ...offered.map(([prefix, name]) => ({ label: name, action: { type: "language" as const, value: prefix } })),
        { label: "Not sure", action: { type: "language", value: null } },
      ]);
    } else if (open.some((need) => need.kind === "major") && nextPrefs.majorPrefix === undefined) {
      say("You haven’t declared a major yet. What are you leaning toward? I’ll suggest an intro course in it. (You can also type any subject.)", [
        ...Object.entries(MAJOR_OPTIONS).map(([prefix, name]) => ({ label: name, action: { type: "major" as const, value: prefix } })),
        { label: "Not sure yet", action: { type: "major", value: null } },
      ]);
    } else {
      buildPlan(nextPrefs, false, currentAudit);
    }
  }

  function suggest(needs: Need[], nextPrefs: Prefs, perNeed: (need: Need) => number) {
    let list = suggestions;
    const created: Suggestion[] = [];
    for (const need of needs) {
      for (const course of recommend(need, context(nextPrefs, [...list, ...created]), perNeed(need))) {
        created.push({ id: nextId.current++, need, course, reason: reasonFor(need, course), status: "pending" });
      }
    }
    list = [...list, ...created];
    setSuggestions(list);
    return created;
  }

  function buildPlan(nextPrefs: Prefs, more = false, currentAudit = audit) {
    if (!currentAudit) return start();
    const sum = summarizeAudit(currentAudit);
    const needs = sum.open.filter((need) => need.kind !== "connections" && !(need.kind === "major" && !nextPrefs.majorPrefix));
    const created = suggest(needs, nextPrefs, (need) => (need.kind === "major" && !more ? 2 : 1));
    const notes: string[] = [];
    if (sum.open.some((need) => need.kind === "major") && !nextPrefs.majorPrefix) notes.push("When you have a major in mind, just tell me (e.g. “I’m thinking economics”) and I’ll add an intro course.");
    if (nextPrefs.languagePrefix === null && sum.open.some((need) => need.kind === "language")) notes.push("Language courses depend on your placement, so double-check you’re eligible for these levels.");
    if (!created.length) {
      say(more ? "I don’t have any more options that fit around your current plan." : "I couldn’t find open sections that fit your plan for what you still need. Try removing a course that’s in the way, or tell me a different subject.", MENU);
      return;
    }
    const planned = currentPlan().length + suggestions.filter((item) => item.status === "accepted").length;
    const total = planned + created.length;
    say(
      [more ? "Here are a few more options:" : "Here’s a draft outline for Spring 2027. Accept the ones you like and they’ll go straight onto your calendar. Reject one and I’ll find an alternative.",
        ...notes, total < 4 ? `That would bring you to ${total} course${total === 1 ? "" : "s"}. Most students take 4, so ask me for more if you want.` : ""].filter(Boolean).join("\n\n"),
      [{ label: "Accept all", action: { type: "accept-all" } }, { label: "Suggest more", action: { type: "more" } }, MENU[0]],
      created.map((item) => item.id),
    );
  }

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
    const [alternative] = recommend(item.need, context(prefs, updated), 1);
    if (alternative) {
      const next: Suggestion = { id: nextId.current++, need: item.need, course: alternative, reason: reasonFor(item.need, alternative), status: "pending" };
      setSuggestions([...updated, next]);
      say(`No problem. Here’s another option for ${item.need.label}:`, undefined, [next.id]);
    } else {
      setSuggestions(updated);
      say(`That was the last option I found for ${item.need.label} that fits your schedule.`, MENU);
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
        askNext(prefs, parsed);
      } else {
        say("That doesn’t look like a Degree Works audit. It should be JSON with a “requirements” list.");
      }
      return;
    }

    const lower = value.toLowerCase();
    const year = /first.?year|fresh|\bfr\b/.test(lower) ? "FR" : /soph|\bso\b/.test(lower) ? "SO" : /junior|\bjr\b/.test(lower) ? "JR" : /senior|\bsr\b/.test(lower) ? "SR" : null;
    const language = matchSubject(lower, LANGUAGE_SUBJECTS);
    const major = matchSubject(lower.replace(/i'?m |thinking|about|major(ing)? in|interested in|leaning toward/g, " "), { ...subjects, ...MAJOR_OPTIONS });

    if (year && !prefs.classYear) return run({ type: "year", value: year });
    if (language && prefs.classYear && prefs.languagePrefix === undefined && summary?.open.some((need) => need.kind === "language")) return run({ type: "language", value: language });
    if (major && /major|thinking|interested|leaning|study/.test(lower)) return run({ type: "major", value: major });
    if (major && prefs.classYear && prefs.languagePrefix !== undefined && prefs.majorPrefix === undefined) return run({ type: "major", value: major });
    if (/still need|what.*need|left|missing|requirement|remaining|audit/.test(lower)) return run({ type: "summary" });
    if (/more|another|other option|else/.test(lower)) return run({ type: "more" });
    if (/plan|recommend|suggest|outline|schedule|what should i take/.test(lower)) return run({ type: "plan" });
    if (/not sure|no idea|undecided|don'?t know/.test(lower)) {
      if (prefs.classYear && prefs.languagePrefix === undefined && summary?.open.some((need) => need.kind === "language")) return run({ type: "language", value: null });
      if (prefs.classYear && prefs.majorPrefix === undefined) return run({ type: "major", value: null });
    }

    setThinking(true);
    try {
      say(await getReply([...messages, { id: -1, role: "user", text: value }]), audit ? MENU : undefined);
    } finally {
      setThinking(false);
    }
  }

  // ---- rendering ---------------------------------------------------------

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Course planning assistant">
          <header className="chat-header">
            <div className="chat-avatar" aria-hidden="true">✦</div>
            <div>
              <strong>Planning Assistant</strong>
              <span>{audit ? `Degree Works loaded · ${audit.requirements.length} requirements · ${audit.courses?.length ?? 0} courses` : "Spring 2027 course advisor"}</span>
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
                        <span className="suggestion-need">{item.need.label}</span>
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
