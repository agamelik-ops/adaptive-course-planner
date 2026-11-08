# adaptive-course-planner
An improved planning app for the students of F&M to select their courses

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Planner

The homepage searches all sections in `app/planner/courses.json`, imported from the Spring 2027 master schedule by `scripts/parse_schedule.py`. Search by CRN, title, subject name, or course code (with or without spaces). Search "language" to explore language subjects. Add and remove sections by CRN; the calendar includes all class and lab meetings and flags overlaps. TBA sections appear in the selected list without calendar blocks.

`app/lib/courses.ts` adapts the shared catalog for the homepage. Credit values are not included in the imported data, so credit totals are unavailable. This is a planning tool, not live registration or seat availability. Homepage plans save automatically to localStorage for Spring 2027 and restore on refresh in the same browser. Only CRNs are stored; deleted catalog entries are ignored. There is no account or cross-device sync. If saving fails, changes remain available for the current session and a warning is shown. The original planner remains at `/planner`, and team workspace routes are linked in the footer.

Use **Download planner** to save a standalone HTML document with a weekday overview and complete course list, including CRNs and TBA sections. It opens offline; the browser Print menu can save it as PDF. Downloads are disabled for an empty plan. During refresh, a restoring placeholder appears until browser storage is read, avoiding a misleading empty schedule.

Export options: **Save as PDF** opens the browser print dialog (choose Save as PDF), **Download PNG** creates an image with the weekday agenda and full course list, and **HTML** downloads an offline document. PNG includes class/lab meetings and TBA sections; unusually large plans should use PDF.

Choose PDF, PNG, or HTML from the **Download planner** dropdown. It is disabled while restoring a plan, when the plan is empty, or while an image is being generated.

Click a search result, a selected course, or a calendar block to view a compact details dialog with instructors, prerequisites, permission requirements, and class-year restrictions from the imported catalog. Missing requirements are labeled "None listed" rather than interpreted as confirmed eligibility. Escape, the close button, or the backdrop dismisses the dialog.

## Automatic seat availability (extension prototype)

1. Run `npm run dev` at **http://localhost:3000**.
2. Load the repo's `extension` folder in Chrome's `chrome://extensions` Developer mode. Reload it after source changes and review Chrome's permissions prompt yourself. Refresh localhost so the updated bridge loads.
3. Click the extension → **Connect to F&M**, from any page. Accept the optional F&M registration-site access prompt to enable the connection. The extension opens its own Browse Classes tab.
4. Sign in and select **Spring 2027** there if prompted. Once that semester is ready, importing starts automatically. No scrolling, manual page changes, or second extension click is needed. It checks planned courses about every **5 minutes** and the full catalog every **30 minutes** while that tab stays open and signed in. Planned courses are checked first on connection. F&M has no CRN search field, so targeted checks use the visible Course Number control (including other subjects/sections with that number). Duplicate course numbers are searched once per pass. Each pass clears search filters; use a separate tab for your own registration browsing.
5. **Disconnect** stops future passes and cancels an in-progress pass. Closing or leaving the registration tab, restarting Chrome, or a scan/session error pauses automatic updates. Click Connect to F&M again to reconnect.

Search results, selected courses, and course details show separate **Seats available** and **Waitlist seats left** bars: remaining seats divided by capacity. Full, unknown, zero-capacity, and reserved-seat conditions remain explicit. “Last checked” is specific to each section. The planner shows periodic-update status and marks overdue status as paused; it never promises an instant live feed. Browser sleep or scheduling may delay checks.

Full sync verifies that unique CRNs collected match Banner's unfiltered section count before claiming completion. It requests up to 50 rows per normal results page, sequentially, and stops on repeated pages, unsupported terms, or timeouts. Failed/cancelled passes preserve partial snapshots without claiming completeness. The former current-page import option has been removed.

Matching uses Banner's observed Spring 2027 term code `202620` and CRN. Other terms are rejected. All Banner sections are scanned, including ones missing from our PDF-based catalog; only existing matching catalog CRNs can be shown in the planner. Syncing availability does not add missing courses, guarantee eligibility, or register anyone.

The extension stores only CRNs, displayed seat status, timestamps, and local scheduling metadata. It does not collect passwords, cookies, holds, or account details. Optional host access to `https://prd-reg9.fandm.edu/*` lets the extension open its own registration tab and resume after sign-in; `scripting` performs the user-authorized page interaction, `storage` keeps snapshots, and `alarms` schedules refreshes. The localhost content script delivers snapshots and update status to the planner. The existing course-schedule redirect is preserved. A hosted planner needs its own explicitly configured origin.

Checks: `node --test scripts/availability.test.mjs`, `npm run lint`, and `npx tsc --noEmit`. Reload and test the updated extension in Chrome as well; fixture tests do not verify a real signed-in session or scheduled browser wakeups.

The extension popup also retains **Import Degree Works requirements**. Open your Degree Works audit, expand the relevant sections, and use that button. The original preview/confirmation is preserved; only approved requirement names and statuses are stored locally as a partial audit. Availability connection and Degree Works import remain separate actions.

The popup displays Connecting while setup/initial import is underway, Connected to F&M after a successful sync, and Not connected for paused or overdue updates. It shows the last successful sync time and completed section count; the Connect button is replaced by Disconnect while connected.

## Degree Works academic import

On the **Academic** worksheet at degreeworks.fandm.edu, click the extension → **Import Degree Works**. It expands academic blocks, reads structured requirements and course tables, and presents an import preview. Confirm in the Degree Works tab. The background worker saves the approved snapshot even if the popup closes, and the existing bridge delivers it to the planner. Refresh localhost after reloading the extension.

Version 2 includes degree, major/minor/concentration, placement results, earned credits, anticipated graduation year, catalog-year blocks, requirement status/detail text, and deduplicated course records with title, grade, credits, term, and completion status where available. Student name and ID are excluded. “In progress” includes preregistered classes. Unsupported grades remain unknown. Worksheet imports are always marked potentially partial; inaccessible blocks and exceptions are not claimed complete.

The popup reports imported course/requirement counts and time. The current local rules-based assistant receives the richer audit and excludes completed/in-progress courses from suggestions. It does not yet verify all prerequisites, evaluate every major requirement, or send audit data to an external AI service. Legacy requirement-only imports still work; reimport to include course history.

Check with `node --test scripts/degree-audit.test.mjs scripts/availability.test.mjs`, lint, and TypeScript. Then reload the extension, import your own worksheet, verify the preview/counts against Degree Works, and open the assistant to check its loaded-audit summary.

Degree Works has its own popup status card: Not linked before an import, Importing during extraction/preview, and Linked once a usable audit is saved. It displays course/requirement counts, the import time, and a saved-snapshot label. Update Degree Works refreshes the snapshot; a failed/cancelled update preserves the last usable audit. This badge does not imply a live Degree Works login or automatic academic-record syncing.

### Availability refresh behavior

Saved results stay visible throughout refreshes and after closing/reopening the planner. A scan commits only after every page in that search is verified; cancellation, repeated pages, and session errors preserve the previous successful snapshot. Seat/status data is rewritten only when records change, with check timestamps stored separately. **Last checked** shows the most recent successful observation for each section; **Last changed** records an observed status change, not the first import (older snapshots show “No changes observed yet”).

The planner shares only its selected CRNs and course numbers with the local extension. Adding/removing courses schedules an early check, or queues one follow-up if a scan is already running. Scans run sequentially with an additional tab-level lock. Refresh intervals begin after completion; browser sleep can delay them. Closing the planner does not stop checks while the dedicated F&M tab remains open. Closing that registration tab, session expiry, or restarting the browser pauses checks without deleting results; reopen the extension and choose **Reconnect to F&M**.

After updating extension files, reload it at `chrome://extensions`, refresh the planner page so its bridge updates, then reconnect.

Run regression checks with `node --test scripts/availability.test.mjs scripts/degree-audit.test.mjs`, `npm run lint`, and `npx tsc --noEmit`. These use synthetic records and simulated browser events, including failed/cancelled scans, unchanged records, closing/reconnecting, session expiry, and plan changes during a scan. Live F&M course-number filtering was also verified; a full end-to-end check of the reloaded extension still requires a signed-in registration session.
