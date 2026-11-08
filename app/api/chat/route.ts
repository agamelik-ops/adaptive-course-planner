// Chat endpoint for the planning assistant.
// Talks to any OpenAI-compatible chat API (Groq by default) using the secret
// key in .env.local. The key never reaches the browser.

import { courseByCrn, runTool, TOOL_DEFINITIONS, type AiSuggestion, type StudentContext } from "../../lib/ai-tools";
import { meeting, type Course } from "../../lib/courses";
import type { ClassYear } from "../../lib/advisor";

const BASE_URL = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";
const API_KEY = process.env.AI_API_KEY;

const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TOOL_ROUNDS = 5;
const RATE_LIMIT = { windowMs: 60_000, max: 15 };
const YEARS = new Set(["FR", "SO", "JR", "SR"]);

// Simple per-IP limit. On serverless hosting each instance keeps its own
// counter, so this is a speed bump rather than a hard guarantee.
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT.max;
}

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}
function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 30).map((item) => item.slice(0, 120)) : [];
}

function readContext(raw: Record<string, unknown> | undefined): StudentContext {
  const plan = textList(raw?.planCrns).map((crn) => courseByCrn(crn)).filter((course): course is Course => !!course);
  const audit = raw?.audit as Record<string, unknown> | undefined;
  const year = text(raw?.classYear);
  const needs = raw?.needIds as Record<string, unknown> | undefined;
  return {
    plan,
    classYear: year && YEARS.has(year) ? (year as ClassYear) : undefined,
    expectedGraduation: text(raw?.expectedGraduation, 30),
    declaredMajor: text(raw?.declaredMajor, 80),
    languagePlacement: text(raw?.languagePlacement, 120),
    mathPlacement: text(raw?.mathPlacement, 80),
    takenCodes: (Array.isArray(raw?.takenCodes) ? raw.takenCodes : []).slice(0, 150)
      .filter((code): code is string => typeof code === "string")
      .map((code) => code.toUpperCase().trim()).filter((code) => /^[A-Z]{2,5} \d{2,4}[A-Z]?$/.test(code)),
    language: text(raw?.language, 40),
    major: text(raw?.major, 60),
    majorSubject: text(raw?.majorSubject, 4)?.toUpperCase(),
    majorUndecided: raw?.majorUndecided === true || undefined,
    languageSubject: text(raw?.languageSubject, 4)?.toUpperCase(),
    audit: audit ? { open: textList(audit.open), inProgress: textList(audit.inProgress), complete: textList(audit.complete) } : undefined,
    needIds: needs ? { open: textList(needs.open), satisfied: textList(needs.satisfied) } : undefined,
  };
}

function systemPrompt(ctx: StudentContext) {
  const lines = [
    "You are the Planning Assistant for the Adaptive Course Planner, a student-built tool for Franklin & Marshall College students planning their Spring 2027 schedule.",
    "Be friendly and brief. Write plain text only: no markdown, headings, bold or asterisks (the chat shows raw text). Simple lines starting with '• ' are fine.",
    "",
    "Length (most important):",
    "- Answer only what was asked, in 1-3 short sentences (about 50 words at most). No intros, recaps, sign-offs or offers like 'Let me know if...'.",
    "- Never repeat what the student can already see. Course cards show each course's title, time, CRN, instructor and reason, and earlier messages already covered their requirements. Don't restate those.",
    "- Don't add disclaimers (adviser, registrar, workload) unless they asked about something official.",
    "",
    "Rules:",
    "- Only talk about courses you found with the tools. Never invent courses, CRNs, times, instructors or requirements. Never guess a course's title: use the title a tool returned, or just the course code.",
    "- When you recommend specific sections, call suggest_courses so the student gets Accept/Reject cards (each reason under 10 words). Then reply with one short sentence; don't describe the courses again.",
    "",
    "Planning a semester:",
    "- When the student asks for a schedule, a plan, recommendations for next semester, or 'what should I take', call build_schedule. Don't assemble a schedule by hand, and don't also call suggest_courses for the same courses (build_schedule already shows them as cards).",
    "- Majors: F&M students declare a major in the spring of sophomore year, so first-years and fall sophomores usually show 'Undeclared' in Degree Works. If the student context has no declared major and no 'Interested in majoring in', the student hasn't named a major in this conversation, and the context doesn't say they're not sure yet, do NOT build yet: ask only 'What major are you thinking about? Not sure is fine.' (don't explain the declaration timeline unless asked). Build only after they answer (if they're not sure, build without major_subject). A junior or senior with no declared major: ask 'What's your major?'",
    "- When the student names a major or interest in chat, pass it as major_subject. If they say they're not sure, pass undecided: true.",
    "- If build_schedule returns ask_student_exactly, reply with exactly that question and nothing else.",
    "- After build_schedule, reply with one short sentence, e.g. 'Here's your plan, built around Computer Science.' Don't list or describe the courses (the cards do). Only mention not_yet_eligible_in_major if the student asked what they can't take yet. Pass along a note only if the student needs to act on it.",
    "- If they reject a course or want changes (no Fridays, later start, different subject), call build_schedule again with those constraints.",
    "- 'Can I take X?': call check_prerequisites and answer in one or two sentences (yes, or no plus what they need first and whether it's offered this spring). search_courses already hides courses they aren't eligible for.",
    "- Respect the student's constraints (days, times, interests). Ask one short question only if a request is truly ambiguous.",
    "- Mention a prerequisite or permission requirement only when it stops them from taking a course.",
    "- You are not an official adviser and cannot register students. If they ask about something official (placement, petitions, declaring a major), point them to their adviser or the Registrar.",
    "- Course difficulty and workload aren't in the data; if asked, say so in one sentence.",
    "",
    "Student context:",
  ];
  if (ctx.audit) {
    lines.push(`- Degree Works still needed: ${ctx.audit.open.join("; ") || "nothing marked incomplete"}`);
    lines.push(`- In progress (done once current classes finish): ${ctx.audit.inProgress.join("; ") || "none"}`);
    lines.push(`- Complete: ${ctx.audit.complete.join("; ") || "none"}`);
  } else {
    lines.push("- No Degree Works audit imported yet.");
  }
  lines.push(`- Class year for Spring 2027: ${ctx.classYear ?? "unknown"} (FR = first-year, SO = sophomore, JR = junior, SR = senior)`);
  if (ctx.expectedGraduation) lines.push(`- Expected graduation: ${ctx.expectedGraduation}`);
  if (ctx.declaredMajor) lines.push(`- Declared major (Degree Works): ${ctx.declaredMajor}`);
  if (ctx.languagePlacement) lines.push(`- Language placement results: ${ctx.languagePlacement}. Recommend the course level matching the placement (e.g. placement 102 means take 102 next).`);
  if (ctx.mathPlacement) lines.push(`- Math placement: ${ctx.mathPlacement}`);
  if (ctx.takenCodes?.length) lines.push(`- Already taken or in progress (don't recommend these): ${ctx.takenCodes.join(", ")}`);
  if (ctx.language) lines.push(`- Studying language: ${ctx.language}`);
  if (ctx.major) lines.push(`- Interested in majoring in: ${ctx.major}${ctx.majorSubject ? ` (${ctx.majorSubject})` : ""}`);
  if (ctx.majorUndecided && !ctx.major) lines.push("- Major: not sure yet (they chose to explore). Don't ask about a major again; call build_schedule with undecided: true.");
  lines.push(ctx.plan.length
    ? `- Current plan: ${ctx.plan.map((course) => `${course.code} ${course.title} (CRN ${course.crn}, ${meeting(course)})`).join("; ")}`
    : "- Current plan: empty");
  return lines.join("\n");
}

class ProviderBusyError extends Error {}

async function callModel(messages: ChatMessage[], retried = false): Promise<ChatMessage | undefined> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOL_DEFINITIONS, tool_choice: "auto", temperature: 0.3, max_tokens: 700 }),
  });
  if (response.status === 429) {
    // Free tiers limit tokens per minute. If the wait is short, retry once.
    const detail = await response.text().catch(() => "");
    const seconds = Number(response.headers.get("retry-after")) || Number(detail.match(/try again in ([\d.]+)s/)?.[1]) || 0;
    if (!retried && seconds > 0 && seconds <= 12) {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 250));
      return callModel(messages, true);
    }
    throw new ProviderBusyError(detail.slice(0, 200));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message as ChatMessage | undefined;
}

export async function POST(request: Request) {
  if (!API_KEY) {
    return Response.json({ error: "not-configured" }, { status: 503 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }

  let body: { messages?: unknown; context?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((item): item is { role: string; text: string } => !!item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string" && item.text.trim() !== "")
    .slice(-MAX_HISTORY)
    .map((item): ChatMessage => ({ role: item.role as "user" | "assistant", content: item.text.slice(0, MAX_MESSAGE_CHARS) }));
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }

  const ctx = readContext(body.context);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(ctx) }, ...history];
  const suggestions: AiSuggestion[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const reply = await callModel(messages);
      if (!reply) throw new Error("Empty response from AI provider");
      if (!reply.tool_calls?.length) {
        return Response.json({ reply: reply.content?.trim() || "Here’s what I found.", suggestions });
      }
      messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });
      for (const call of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        const result = runTool(call.function.name, args, ctx, suggestions);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return Response.json({ reply: "I looked at a lot of options. Here are the best ones I found.", suggestions });
  } catch (error) {
    if (error instanceof ProviderBusyError) {
      return Response.json({ error: "busy" }, { status: 429 });
    }
    console.error("Chat AI error:", error);
    return Response.json({ error: "ai-unavailable" }, { status: 502 });
  }
}
