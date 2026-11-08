# Adaptive Course Planner

A course planner for Franklin & Marshall College students. Search the Spring 2027 schedule, build your week on a calendar, see live seat counts, and get a 4-course plan from an AI assistant that reads your Degree Works audit and checks prerequisites.

**Live site:** https://adaptive-course-planner.vercel.app/

> Student project for planning only. Not an official Franklin & Marshall College website, and it does not register you for courses. Always confirm your plan with your adviser and the Registrar.

## Contents

- [What it does](#what-it-does)
- [How it fits together](#how-it-fits-together)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Install the Chrome extension](#install-the-chrome-extension)
- [Using the app (student walkthrough)](#using-the-app-student-walkthrough)
- [The course planner](#the-course-planner)
- [The planning assistant](#the-planning-assistant)
- [Seat availability sync](#seat-availability-sync)
- [Degree Works import](#degree-works-import)
- [Data, storage and privacy](#data-storage-and-privacy)
- [Testing](#testing)
- [Deployment (Vercel)](#deployment-vercel)
- [Team git workflow](#team-git-workflow)
- [Updating for a new semester](#updating-for-a-new-semester)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Team and license](#team-and-license)

## What it does

| Part | What students get |
| --- | --- |
| **Course planner** (website) | Search all 581 Spring 2027 sections by name, code, CRN, subject, professor or gen-ed tag. Add courses to a Mon–Fri calendar that places overlapping classes side by side. Click any course for details. Export to PDF, PNG, an offline web page or Google Calendar. The plan saves in the browser automatically. |
| **Planning assistant** (chat bubble, bottom right) | Reads your Degree Works audit and asks what's missing (class year, major, language). It then builds a 4-course plan that respects prerequisites, placements, class-year restrictions and time conflicts. Courses appear as cards you Accept or Reject. Free-form questions ("can I take CPS 261?", "what does Jing Hu teach?") go to an AI that can only answer from the real catalog. |
| **Chrome extension** | Imports your Degree Works audit into the planner, keeps seat and waitlist counts up to date from F&M's registration site, and sends F&M's course schedule page to the planner. |

## How it fits together

```
Spring 2027 Master Schedule (PDF)
   │  scripts/parse_schedule.py  (pdfplumber)
   ▼
app/planner/courses.json  (581 sections, 404 courses, 46 subjects)
   │  app/planner/courses.ts → app/lib/courses.ts
   ▼
Planner UI (app/components/planner.tsx) ◄──────────────┐
Chat widget (app/components/chat-widget.tsx)            │
   │  typed questions: POST /api/chat                   │ page localStorage
   ▼                                                    │
app/api/chat/route.ts ──► Groq (OpenAI-compatible API)  │
   with 5 tools in app/lib/ai-tools.ts that query the   │
   real catalog, prerequisites and schedule builder     │
                                                        │
Chrome extension ───────────────────────────────────────┘
   • Degree Works page ─ Import ─► chrome.storage "degreeAudit" ─ bridge.js ─► planner
   • F&M Browse Classes (prd-reg9) ─ every 5 / 30 min ─► chrome.storage ─ planner-bridge.js ─► seat bars
   • webapps.fandm.edu/courseschedule ─ redirect.js ─► planner
```

## Project structure

```
app/
  page.tsx                  Home page; renders the planner (the only planner)
  layout.tsx                Root layout; mounts the chat widget on every page
  globals.css               All styles (Tailwind v4 + custom classes)
  favicon.ico, apple-icon.png
  api/chat/route.ts         Chat endpoint: system prompt, context sanitizing, rate limit, tool loop
  components/
    planner.tsx             Search, "Your courses" list, weekly calendar, exports
    chat-widget.tsx         Planning assistant UI + rules engine (questions, plan cards)
    course-details.tsx      Course details dialog (with + Add to plan)
    availability-status.tsx Seat / waitlist bars
    auto-update-status.tsx  "Updated X ago" status for seat sync
  lib/
    courses.ts              Catalog helpers: search, meeting times, overlaps, subject names
    schedule.ts             4-course schedule builder (picks, blocked courses, alternatives)
    prereqs.ts              Prerequisite parser/checker (met / unmet / unknown)
    advisor.ts              Turns Degree Works requirements into "needs" (Arts, Language…)
    ai-tools.ts             The 5 tools the AI can call + student context type
    degree-audit.ts         Audit types, parsing, saved audit, class year from grad year
    saved-plan.ts           Saves the plan (CRNs) in localStorage
    availability.ts         Reads seat snapshots delivered by the extension
    download-plan.ts        PDF (print), PNG and offline HTML exports
    export-calendar.ts      Google Calendar .ics export
  planner/
    courses.json            The catalog (generated; don't edit by hand)
    courses.ts              Catalog types + loader
    page.tsx                /planner now redirects to /
extension/                  Chrome extension (Manifest V3); see below
scripts/
  parse_schedule.py         Master Schedule PDF → courses.json
  schedule.test.mjs         Prerequisite + schedule builder tests (19)
  availability.test.mjs     Seat sync + extension bridge tests (16)
  degree-audit.test.mjs     Degree Works import tests (4)
.env.example                AI settings template (copy to .env.local)
AGENTS.md                   Note for AI coding agents: Next.js 16 differs from older versions
```

## Run it locally

**You need:** Node.js 20.9 or newer (Next.js 16 requires it), npm, and Chrome for the extension. For the AI you also need a free Groq API key.

```bash
git clone https://github.com/agamelik-ops/adaptive-course-planner.git
cd adaptive-course-planner
npm install
cp .env.example .env.local      # then paste your key after AI_API_KEY=
npm run dev                     # http://localhost:3000
```

**Getting a Groq key:** sign in at https://console.groq.com, open **API Keys → Create API Key**, copy it into `.env.local` as `AI_API_KEY=gsk_...`, then restart `npm run dev`. Don't put spaces or quotes around the key, and never commit `.env.local` (git already ignores it).

**AI settings** (all in `.env.local`):

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_API_KEY` | (none) | Required for the AI. Without it, typed questions fall back to the built-in rules engine, and the buttons still work. |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | Any OpenAI-compatible API that supports tool calling. |
| `AI_MODEL` | `openai/gpt-oss-120b` | Must support tool calling. Groq's model list changes over time. |

To run the AI fully on your own machine, install [Ollama](https://ollama.com), run `ollama pull qwen2.5`, and set `AI_BASE_URL=http://localhost:11434/v1`, `AI_MODEL=qwen2.5` and `AI_API_KEY=ollama`.

Other commands: `npm run build` (production build), `npm start` (serve the build), `npm run lint`.

## Install the Chrome extension

Until it's on the Chrome Web Store, everyone loads it by hand:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this repo's `extension/` folder.
3. Pin it from the puzzle-piece menu.

It works with both the live site and `http://localhost:3000`. The planner address is set in two places that must match: `PLANNER_URL` in `extension/config.mjs`, and the URL in `extension/redirect.js`. Content scripts can't import modules, which is why it's written twice.

**After pulling extension changes:** click the reload button ↻ on the extension in `chrome://extensions`, then refresh any open planner tab. Old tabs keep the previous copy of the scripts.

**Permissions and why:**

| Permission | Used for |
| --- | --- |
| `activeTab` + `scripting` | Reading the Degree Works page you're on when you click Import, and running the seat scan in the extension's own F&M tab |
| `storage` | Saving the audit, seat snapshots and sync settings in the extension |
| `alarms` | Scheduling the 5-minute and 30-minute seat checks |
| Optional: `https://prd-reg9.fandm.edu/*` | Requested only when you click **Connect to F&M**. Lets the extension open and read its own Browse Classes tab. |

Content scripts run only on `webapps.fandm.edu/courseschedule` (redirect) and the planner itself (bridges). The extension loads no remote code.

## Using the app (student walkthrough)

1. **Import Degree Works** (once per semester, or whenever it changes): open your **Academic** worksheet at degreeworks.fandm.edu, click the extension, then **Import Degree Works**. Review the summary and confirm. The planner picks it up automatically, and the extension popup shows "Linked".
2. **(Optional) Turn on live seats:** extension → **Connect to F&M**. Allow the site-access prompt, sign in if asked, and choose **Spring 2027**. Keep that tab open.
3. **Open the planner** (extension → **Open planner**, or the live site).
4. **Open the chat bubble.** It says what you still need, asks anything it can't find in Degree Works, and builds your plan. Accept the courses you like; they go straight onto your calendar.
5. **Adjust:** search for courses yourself, click any course for details, use **+** to add or **×** to remove, and ask the assistant for changes ("no Friday classes", "something later in the day").
6. **Export** with **Download planner**: PDF, PNG, offline HTML, or a Google Calendar file.

## The course planner

**Search** (`searchCourses` in `app/lib/courses.ts`): every word you type must match somewhere in the CRN, course code (with or without the space, so `CPS111` works), subject name ("computer science"), title, instructor ("Jing Hu" or "Hu"), or gen-ed tag (`ARTS`, `WRLD`…). Typing "language" lists all language subjects. Results show times, instructors, CRN, section and seat bars.

**Your courses:** the list scrolls on its own once it's taller than about 440px, so the page doesn't keep growing. Each course shows seat and waitlist bars and opens its details when clicked. TBA sections, such as private lessons, appear here with "Meeting time TBA" but not on the calendar.

**Calendar:** Monday–Friday, starting at 8:00 am. Class and lab meetings both show. Overlapping classes are placed side by side so a conflict is easy to spot. Hover over a block and click **×** to remove the course.

**Course details dialog:** opens from a search result, your course list or a calendar block. It shows meeting times, seat availability, instructors, prerequisites (as written by the Registrar), the permission requirement and class-year restrictions. Missing information is labeled "None listed"; that doesn't confirm you're eligible. The round **+** button adds the course, and shows **✓** if it's already in your plan. Close it with Esc, ×, or by clicking outside.

**Saving:** the plan saves automatically in this browser (`localStorage`, CRNs only) and comes back on refresh. There's no account or cross-device sync. If saving fails, you keep your changes for the session and see a warning.

**Download planner** (disabled while the plan is restoring, empty, or exporting):

| Option | Result |
| --- | --- |
| PDF document | Opens the print dialog; choose "Save as PDF" |
| PNG image | `fm-spring-2027-course-plan.png` with a weekday agenda and course list (use PDF for very large plans) |
| Offline webpage | A standalone HTML file that opens without internet |
| Google Calendar | `fm-spring-2027.ics`, with repeating classes from Jan 19 to Apr 29, 2027, skipping spring recess (Mar 13–21). Exams aren't included. Import it in Google Calendar under **Settings → Import & export → Import**, ideally into a separate calendar so you can replace it later. It doesn't sync changes. |

## The planning assistant

Two parts work together:

- **A rules engine in the browser** (`chat-widget.tsx` plus `lib/schedule.ts`, `lib/prereqs.ts`, `lib/advisor.ts`). It handles the buttons and answers to its own questions. It works without any AI key.
- **The AI** (`app/api/chat/route.ts` plus `lib/ai-tools.ts`). It handles free-form typed questions, and can only answer by calling tools that read the real catalog.

### Conversation flow

1. **Welcome:** with an imported audit, one message such as *"Hi! I loaded your Degree Works (junior, Computer Science major). Still needed: World Perspectives."* Without one, it explains how to import, and offers **Paste audit data** as a fallback that accepts the `degreeAudit` JSON.
2. **Class year:** worked out from Degree Works' *Anticipated Grad Year* for the Spring 2027 term: 2027 or earlier → senior, 2028 → junior, 2029 → sophomore, 2030 or later → first-year (`classYearFromAudit`, `SPRING_TERM_YEAR = 2027`). It only asks if it can't tell. Typing "actually I'm a junior" corrects it.
3. **Major:** if Degree Works shows a declared major, it uses it without asking. F&M students declare in the **spring of sophomore year**, so first-years and fall sophomores usually show "Undeclared". They're asked *"What major are you thinking about? Not sure is fine."*, with buttons for 12 common majors and **Not sure yet**. Juniors and seniors with no major are asked *"What's your major?"* "Not sure" builds a plan for exploring, with intro courses. Naming a major later ("I'm thinking economics") rebuilds the plan.
4. **Language:** asked only if the language requirement is open and the language can't be worked out from placements (e.g. "French Placement 102") or language courses already taken.
5. **Plan:** *"Here's your plan, built around Computer Science."* plus 4 course cards. Buttons: **Accept all**, **Suggest more** (2 more options), and **What can't I take yet?** (major courses blocked by prerequisites, with what's missing). **Reject** on a card swaps in another course for the same slot.

### How a 4-course plan is built (`buildSchedule` in `app/lib/schedule.ts`)

Slots are filled in this order until the plan, counting courses already on your calendar, reaches 4:

1. The next course in your major.
2. Your language at your level, if the language requirement is open. It only picks a course whose prerequisite you clearly meet, and never steps back to a lower level.
3. One course for each open gen-ed requirement: Arts, Humanities, Social Sciences, Natural Science with Lab, Natural Science in Perspective or 2nd lab, World Perspectives, Non-Western Cultures.
4. First-years and sophomores get a supporting subject the major usually needs (CPS → MAT, DSC → MAT/CPS, ECO → MAT, BIO → CHM, CHM → MAT/PHY, PHY → MAT, MAT → CPS, BOS → ECO, ENE → CHM). Juniors and seniors get a second major course.
5. Electives fill any remaining slots. Undeclared students get intro courses to explore possible majors; other students get courses that also count toward an open requirement. It avoids repeating a subject.

**A course is never suggested if:**
- you already took it, or it's in progress
- it's already chosen, or it's the cross-listed twin of a chosen course
- it overlaps another course in the plan
- it's closed to your class year
- it needs instructor permission
- its prerequisite isn't met
- it has no meeting time
- it's a lab-only or half-credit section
- it's at the intro level when your placement is higher
- it's a 400-level course and you aren't an upper-level student in that major

Your constraints (days off, earliest start, latest end) are applied too. If a course has a separate lab, its card says so.

**Prerequisite checker** (`checkPrereq` in `app/lib/prereqs.ts`): parses the Registrar's text into AND/OR logic and returns one of three answers:
- **met**
- **unmet**, with only the missing part in plain words, e.g. "Needs CPS 237 or MAT 237."
- **unknown**, for instructor permission or wording it can't verify

It handles:
- compact codes (`CPS112`)
- "MAY BE TAKEN CONCURRENTLY"
- `PLACEMENT IN 110`, read using the subject of the nearest course code before it
- "ADVANCED" placements
- `A; OR B` lists of alternatives
- written rules such as "Two prior philosophy courses", "One PHI or one PSY course", "SOC 100 plus one other SOC course" and "courses at 221-250 level"

### What the AI can do (`app/lib/ai-tools.ts`)

| Tool | Purpose |
| --- | --- |
| `search_courses` | Search sections with filters: requirement tag, subject, level, days to skip, earliest and latest times, fits the plan. Recommendation searches hide courses you took or can't take yet. Looking up a professor or a course code lists every section, labeled taken, in plan, or prerequisite status. |
| `get_course_details` | Full details plus the description and a prerequisite check, by CRN or course code |
| `build_schedule` | Runs the schedule builder above and shows the picks as Accept/Reject cards. It refuses to plan until it knows the major, or until the student has said they're not sure. |
| `check_prerequisites` | "Can I take X?": met, unmet or unknown, with what's missing, real course titles, and whether each prerequisite is offered this spring |
| `suggest_courses` | Shows hand-picked sections as cards. Each CRN must be real, can't already be a card, and can't overlap the plan or the other cards. |

**Behavior rules** (system prompt in `route.ts`):
- plain text only
- 1–3 short sentences, about 50 words at most
- never repeat what the cards already show
- never invent courses, CRNs, times, instructors or titles
- point students to their adviser or the Registrar for anything official

**Limits:**

| Limit | Value |
| --- | --- |
| Questions per IP address | 15 per minute (kept per server instance) |
| Conversation history | Last 12 messages, each cut to 2,000 characters |
| Tool rounds per answer | Up to 5 |
| Reply length | `max_tokens` 700, temperature 0.3 |
| Groq free tier | Retries once if Groq asks to wait 12 seconds or less. Otherwise the student sees "The assistant is busy right now." |

**Groq free-tier quota** for `openai/gpt-oss-120b`, observed November 2026:
- **8,000 tokens per minute**
- **1,000 requests per day**
- **200,000 tokens per day**

Each answer uses a few thousand tokens, so **the whole site gets roughly 30–60 AI answers per day**. For a demo, avoid heavy testing beforehand, or upgrade Groq to its paid Dev tier (console.groq.com → Settings → Billing). When the AI is unavailable, "What do I still need?", "Build my plan" and the cards still work.

### What the AI is sent

Only:
- requirement names and statuses
- class year and expected graduation year
- declared or chosen major and language
- placement results
- the course codes you've taken or are taking
- the CRNs in your plan

**Never:** your name, student ID, grades, credits or terms. The import confirmation in Degree Works says the same.

## Seat availability sync

*(Built by Wesley. Code: `extension/background.js`, `full-sync.mjs`, `planner-bridge.js`, `connect-watch.js`, `connection-status.mjs`.)*

1. Extension → **Connect to F&M**, from any page, then accept the optional site-access prompt. The extension opens its own **Browse Classes** tab on `prd-reg9.fandm.edu`.
2. Sign in and choose **Spring 2027** if prompted. Importing starts by itself once that term is ready; no scrolling or extra clicks needed.
3. It checks your **planned courses about every 5 minutes** (those come first on connect) and the **full catalog every 30 minutes**, as long as that tab stays open and signed in. Adding or removing a course triggers an early check, or queues one if a scan is already running.
4. **Disconnect** stops future passes and cancels one in progress. Closing or leaving that tab, restarting Chrome, or a session error pauses updates. Click **Connect to F&M** again to resume.

**How it works:**
- Banner has no CRN search field, so targeted checks filter by Course Number, which can include other sections with the same number. Duplicate numbers are searched once per pass.
- Each pass clears the search filters, so use a different tab for your own browsing.
- A full sync asks for up to 50 rows per page, one page at a time. It counts as complete only once the unique CRNs it collected match Banner's unfiltered section count.
- Repeated pages, other terms, timeouts and cancellations stop the pass. The last good snapshot stays in place, and a partial one is never called complete.
- Matching uses Banner's term code **`202620`** (Spring 2027) and the CRN. Every Banner section is scanned, but only CRNs that exist in our catalog show up in the planner. Syncing never adds courses, guarantees eligibility, or registers anyone.
- **Last checked** is the latest successful check of that section. **Last changed** is the last time its status actually changed; older snapshots say "No changes observed yet".
- The planner shows the update status, and marks it paused when it's overdue. It never claims to be an instant live feed, and browser sleep can delay checks.

**In the planner:** search results, your course list and course details show **Seats available** and **Waitlist seats left** bars (remaining ÷ capacity). Full, unknown, zero-capacity and reserved-seat cases are labeled explicitly.

**The popup** shows "Connecting" during setup, "Connected to F&M" after a good sync, and "Not connected" when paused or overdue. It also shows the last sync time and the number of sections.

**What's stored:** CRNs, the displayed seat status, timestamps and scheduling data. Never passwords, cookies, holds or account details.

## Degree Works import

*(Built by Wesley and Alex. Code: `extension/degree-audit.mjs`, `background.js`, `bridge.js`, `app/lib/degree-audit.ts`.)*

1. On the **Academic** worksheet at degreeworks.fandm.edu, click the extension → **Import Degree Works**.
2. The extension expands the academic blocks, reads the requirements and course tables, and shows a confirmation with counts, for example "24 requirements, 31 course records, 6 academic blocks…".
3. Confirm. The background worker saves the audit even if the popup closes, and `bridge.js` hands it to any open planner tab, including ones that open later.

**What's imported (version 2):**
- degree, major, minor, concentration
- placement results
- earned credits
- anticipated graduation year
- catalog-year blocks
- each requirement's status and detail text
- course records (code, title, grade, credits, term, completed or in progress), with duplicates removed

"In progress" includes preregistered classes. **Name and student ID are never imported.** Every worksheet import is marked as possibly partial; blocks it can't reach and exceptions aren't counted as complete. Older requirement-only imports still work; import again to get course history.

**The popup's Degree Works card:** "Not linked" before an import, "Importing" while it's reading, and "Linked" once it's saved, with the counts and import time. **Update Degree Works** re-imports. A failed or cancelled update keeps the previous audit. "Linked" means a saved snapshot, not a live Degree Works connection.

## Data, storage and privacy

Everything stays in your browser, except the AI summary described above.

| Where | Key | Contents |
| --- | --- | --- |
| Page `localStorage` | `fm-course-planner:spring-2027:v1` | Your plan (CRNs) |
| Page `localStorage` | `fm-course-planner:degree-audit:v1` | The audit the planner received |
| Page `localStorage` | `fm-availability:spring-2027:v1` | Seat snapshot delivered by the extension |
| Page `localStorage` | `fm-availability-auto` | Seat sync status shown in the planner |
| Page `localStorage` | `fm-availability-plan:202620` | Planned CRNs and course numbers shared with the extension for early checks |
| Extension `chrome.storage.local` | `degreeAudit`, `degreeAuditImport` | Imported audit and the import status |
| Extension `chrome.storage.local` | `fm-availability…` keys | Seat snapshots, check times, sync settings and job state |

**How the page and the extension talk:**
- `bridge.js` posts the audit to the page with `window.postMessage`, checking the source and origin. The page asks for it with `request-degree-audit`.
- `planner-bridge.js` copies seat data into the page's `localStorage` and sends the plan back.

## Testing

```bash
npx tsc --noEmit                          # type check
npm run lint                              # ESLint (Next.js rules + strict React hooks)
node --test scripts/*.test.mjs            # all 39 tests
npm run build                             # the same production build Vercel runs
```

| File | Tests | Covers |
| --- | --- | --- |
| `scripts/schedule.test.mjs` | 19 | Placement parsing, AND/OR prerequisites, placements, concurrent courses, written rules, plain-word "missing" output, and schedules for an undeclared first-year, a sophomore economics student, a junior CS student, Spanish placement 101, a full plan, seniors and closed sections, no-Friday or late-start limits, Reject alternatives, and a student who has taken every intro course. Every schedule is checked for duplicates, overlaps, cross-listed twins, permission, already-taken courses, class-year restrictions and unmet prerequisites. Runs against the real catalog. |
| `scripts/availability.test.mjs` | 16 | Full and targeted seat sync, repeated pages and cancellation, the scheduler, status display, seat bars, the connection watcher and the planner bridge |
| `scripts/degree-audit.test.mjs` | 4 | Degree Works extraction and parsing |

The tests use simulated pages and fixtures. After changing the extension, also reload it and test with a real signed-in F&M session. To spot-check the AI, run the site locally and ask it questions. Each question uses part of the shared daily Groq quota.

## Deployment (Vercel)

- **Auto-deploy:** every push to `main` on GitHub deploys to https://adaptive-course-planner.vercel.app/ within a minute or two. Other branches don't change the live site.
- **Environment:** `AI_API_KEY` is set under Vercel → Project → Settings → Environment Variables. Add `AI_BASE_URL` or `AI_MODEL` there too if you change them, then redeploy.
- **Checking a deploy:** look at the ✓ or ✗ next to the commit on GitHub, or run `gh api repos/agamelik-ops/adaptive-course-planner/commits/<sha>/status`.
- **"Deployment was blocked":** the project is on Vercel's free (Hobby) plan with a private repo. Vercel only deploys commits whose author it can match to the project owner's account.
  - Every committer should set a real Git identity linked to their GitHub account:
    ```bash
    git config --global user.name "Your Name"
    git config --global user.email "<id>+<username>@users.noreply.github.com"   # or a verified GitHub email
    ```
  - Commits made without this get an address like `you@Your-MacBook.local`, and Vercel blocks them.
  - Teammates' own commits may still be blocked on the Hobby plan. Workarounds: the project owner does the final merge into `main` with `git merge --no-ff <branch>`, so the newest commit is theirs; or make the repo public; or upgrade Vercel.
  - A blocked deploy isn't retried. Push a new commit, e.g. `git commit --allow-empty -m "Redeploy"`.

## Team git workflow

```bash
git checkout main && git pull            # start from the latest main
git checkout -b my-feature               # work on a branch
# ...commit as you go...
git checkout main && git pull            # get teammates' work first
git merge my-feature                     # bring your branch into main
npx tsc --noEmit && npm run lint && node --test scripts/*.test.mjs
git push                                 # Vercel deploys main
```

Small fixes, like a one-line test change, can go straight to `main`. After pulling, run `npm install` if `package.json` changed, and reload the extension if anything in `extension/` changed.

This is **Next.js 16**, and some APIs and conventions differ from older versions. Check `node_modules/next/dist/docs/` before relying on older examples; `AGENTS.md` says the same for AI coding tools. `next dev` and `next build` can run at the same time, since dev output goes to `.next/dev`.

## Updating for a new semester

1. **New catalog:** run `pip install pdfplumber`, then:
   ```bash
   python scripts/parse_schedule.py "path/to/<Term> Master Schedule.pdf" app/planner/courses.json
   ```
   The script removes duplicate rows by CRN and rejoins rows split across page breaks. Don't edit `courses.json` by hand.
2. **Update the hard-coded term.** Search for `202620`, `Spring 2027`, `spring-2027`, `2027-0` and `SPRING_TERM_YEAR`. As of now they appear in:
   - **App:** `app/lib/degree-audit.ts`, `availability.ts`, `saved-plan.ts`, `export-calendar.ts` (class dates and recess), `download-plan.ts`, `ai-tools.ts`, `advisor.ts`, `app/api/chat/route.ts`, `app/components/planner.tsx`, `chat-widget.tsx`, `course-details.tsx`, `app/planner/courses.ts`
   - **Extension:** `background.js`, `full-sync.mjs` (Banner term code), `planner-bridge.js`, `connect-watch.js`, `connection-status.mjs`, `popup.js`, `popup.html`, `manifest.json`
3. Changing the storage keys gives everyone a fresh plan for the new term, which is usually what you want.
4. Run all the tests. Several in `schedule.test.mjs` use specific Spring 2027 CRNs and will need new examples.

## Known limitations

- **Major requirements aren't modeled.** "Next course in your major" comes from prerequisites and course levels, not the official list of required courses for each major.
- **Gen-ed requirements** are recognized from Degree Works requirement names (`RULES` in `app/lib/advisor.ts`). Unusual names may not be detected.
- **Credits** aren't in the Master Schedule PDF, so totals show "Credits unavailable", and half-credit courses are found from their descriptions.
- **One semester:** Spring 2027 is hard-coded (see above).
- **One browser:** no accounts or sync.
- **AI quota:** the free Groq tier serves roughly 30–60 AI answers per day for the whole site.
- **The extension isn't on the Chrome Web Store yet**, so it has to be loaded by hand. Publishing needs:
  - an unofficial name and icon, since "F&M" branding can be rejected as impersonation
  - a privacy policy page
  - removing `http://localhost:3000/*` from the packaged manifest
  - store screenshots
  - ideally, F&M IT's OK for the automated seat checks
- **The course-schedule redirect** (`redirect.js`) always sends `webapps.fandm.edu/courseschedule` to the planner, so the original page can't be reached while the extension is on.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Chat says "The assistant is busy right now" | Groq's free per-minute or daily limit was hit. Wait a minute; if it continues, the daily quota is used up. The buttons still work. |
| Chat can't answer typed questions locally | `AI_API_KEY` is missing from `.env.local`, or has a stray space. Fix it and restart `npm run dev`. |
| The assistant doesn't know my class year or courses | Re-import Degree Works, then refresh the planner tab. Check that the extension popup says "Linked". |
| "Extension context invalidated" on the extension's Errors page | You reloaded the extension while a planner tab was open. Refresh the tab and click **Clear all**. Fixed in `bridge.js`; only tabs opened before the fix show it. |
| Seat bars say paused or overdue | The F&M tab was closed, signed out or left Browse Classes. Click **Connect to F&M** again. |
| The live site didn't update after a push | Check the Vercel ✓/✗ on the commit. "Deployment was blocked" means the commit author isn't linked; see [Deployment](#deployment-vercel). |
| `/planner` sends me to the home page | Expected. The planner lives at `/`. |

## Team and license

Built by F&M students. Main areas, from the git history:
- **Alexander Gameli-Kwame** ([@agamelik-ops](https://github.com/agamelik-ops)): planner UI, planning assistant and AI integration, schedule builder, prerequisite checker, PDF parser, deployment
- **Wesley:** seat availability sync, Degree Works import, course details, saved plans, PDF/PNG/HTML downloads
- **Jay (Jason) Galvez:** Google Calendar export, planner fixes

MIT License. See [LICENSE](LICENSE).
