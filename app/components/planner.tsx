"use client";

import Image from "next/image";
import CourseDetails from "./course-details";
import AvailabilityStatus from "./availability-status";
import AutoUpdateStatus from "./auto-update-status";
import { parseAvailability, readAvailability, serverAvailability, subscribeAvailability } from "../lib/availability";
import Link from "next/link";
import { downloadPlan, downloadPlanPng, printPlan } from "../lib/download-plan";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readPlan, restoreCourses, savePlan, serverPlan, subscribePlan } from "../lib/saved-plan";
import { meeting, overlaps, searchCourses, time, type Course } from "../lib/courses";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function Planner() {
  const [detailCourse, setDetailCourse] = useState<Course | null>(null);
  const availabilitySnapshot = useSyncExternalStore(subscribeAvailability, readAvailability, serverAvailability);
  const availability = useMemo(() => parseAvailability(availabilitySnapshot), [availabilitySnapshot]);
  const [query, setQuery] = useState("");
  const savedPlan = useSyncExternalStore<string | null | undefined>(subscribePlan, readPlan, serverPlan);
  const selected = useMemo(() => restoreCourses(savedPlan ?? null), [savedPlan]);
  const loading = savedPlan === undefined;
  const [saveError, setSaveError] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!downloadOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!downloadRef.current?.contains(event.target as Node)) setDownloadOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [downloadOpen]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const results = searchCourses(query);
  const events = selected.flatMap((course) => course.meetings.map((item, index) => ({ ...course, ...item, eventId: `${course.crn}-${index}` })));
  const conflicts = selected.flatMap((course, index) =>
    selected.slice(index + 1).filter((other) => overlaps(course, other)).map((other) => `${course.code} and ${other.code}`),
  );

  function updatePlan(next: Course[]) {
    setSaveError(!savePlan(next));
  }

  function add(course: Course) {
    updatePlan(selected.some((item) => item.crn === course.crn) ? selected : [...selected, course]);
    setNotice(`${course.code} added to your plan.`);
  }

  function remove(course: Course) {
    updatePlan(selected.filter((item) => item.crn !== course.crn));
    setNotice(`${course.code} removed from your plan.`);
  }

  return (
    <>
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="Franklin & Marshall College Course Planner home"><Image src="/fm-logo.png" alt="Franklin & Marshall College" width={1023} height={198} priority className="wordmark-logo" /><span>COURSE<br />PLANNER</span></Link>
      </header>
      <main className="planner-shell">
        <div className="page-heading"><div><h1>Make room for what’s next.</h1><p>Find your classes. Build your week. See the possibilities.</p></div><span className="demo-badge">Spring 2027</span></div>
        <p className="demo-note">Courses from the imported Spring 2027 master schedule. Planning does not register you or confirm seat availability. Your plan saves automatically in this browser for Spring 2027.</p>
        <div className="availability-guide"><strong>Seat availability</strong><AutoUpdateStatus /><p>Click “Connect to F&M” in the extension. It opens the registration page and imports all Spring 2027 availability for you. Sign in and select Spring 2027 if prompted—no scrolling or paging needed. Keep the F&M tab open for automatic updates every 5 minutes.</p><a href="https://prd-reg9.fandm.edu/StudentRegistrationSsb/ssb/classSearch/classSearch" target="_blank" rel="noreferrer">Open Browse Classes ↗</a></div>
        <div className="planner-layout">
          <aside className="sidebar">
            <section className="panel search-panel" aria-labelledby="find-heading">
              <div className="section-title"><h2 id="find-heading">Find a course</h2><span>01</span></div>
              <label htmlFor="course-search">Search by name, subject, code, or CRN</label>
              <div className="search-input"><span aria-hidden="true">⌕</span><input id="course-search" type="search" placeholder="Try Spanish, language, CPS 111, or a CRN" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              <p className="result-count" role="status">{results.length} {results.length === 1 ? "course" : "courses"} {query.trim() ? "found" : "to explore"}</p>
              <ul className="course-results">
                {results.map((course) => {
                  const added = selected.some((item) => item.crn === course.crn);
                  return <li key={course.crn} className="course-result"><button className="course-detail-trigger search-detail-trigger" aria-label={`View details for ${course.code}, CRN ${course.crn}`} onClick={() => setDetailCourse(course)}><span className={`course-code ${course.color}`}>{course.code}</span><span className="result-title">{course.title}</span><span className="result-meta">{meeting(course)}</span><span className="result-meta">CRN {course.crn}{course.section ? ` · Section ${course.section}` : ""}<AvailabilityStatus record={availability[course.crn]} /><span className="details-hint">View details ↗</span></span></button><button className="add-button" disabled={loading || added} aria-label={added ? `${course.code} already added` : `Add ${course.code}: ${course.title}`} onClick={() => add(course)}>{added ? "✓" : "+"}</button></li>;
                })}
              </ul>
              {results.length === 0 && <div className="no-results"><h3>No matching courses</h3><p>Try a broader subject, a course title, or a CRN.</p><button onClick={() => setQuery("")}>Clear search</button></div>}
            </section>
            <section className="panel selected-panel" aria-labelledby="selected-heading">
              <div className="section-title"><h2 id="selected-heading">Your courses</h2><span>02</span></div>
              {loading ? <div className="plan-loading" role="status"><span className="loading-bar" /><span className="loading-bar" />Restoring your saved plan…</div> : <>
              <p className="save-status" role="status">{saveError ? "Could not save in this browser. Your changes will last for this session only." : "Auto-save enabled · This browser only"}</p>
              <div className="plan-totals"><strong>{selected.length} courses</strong><span>Credits unavailable</span></div>
              {selected.length === 0 ? <p className="empty-selection">Your week is a blank canvas. Add a course above to get started.</p> : <ul className="selected-list">{selected.map((course) => <li key={course.crn} className={`selected-course ${course.color}`}><button className="course-detail-trigger selected-detail-trigger" aria-label={`View details for ${course.code}, CRN ${course.crn}`} onClick={() => setDetailCourse(course)}><strong>{course.code} · {course.crn}</strong><span>{course.title}</span>{course.meetings.length === 0 && <span>Meeting time TBA</span>}<AvailabilityStatus record={availability[course.crn]} /><span className="details-hint">View details ↗</span></button><button aria-label={`Remove ${course.code}`} onClick={() => remove(course)}>×</button></li>)}</ul>}
              </>}
              <p className="sr-only" role="status">{notice}</p>
            </section>
          </aside>
          <section className="panel schedule-panel" aria-labelledby="schedule-heading">
            <div className="schedule-heading"><div><h2 id="schedule-heading">Your weekly schedule</h2></div><div className="download-actions">
              <div className="download-dropdown" ref={downloadRef} onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDownloadOpen(false);
              }} onKeyDown={(event) => {
                if (event.key === "Escape") { setDownloadOpen(false); downloadButtonRef.current?.focus(); }
              }}>
                <button ref={downloadButtonRef} className="download-trigger" aria-expanded={downloadOpen} aria-controls="download-options" disabled={loading || !selected.length || exporting} onClick={() => setDownloadOpen(!downloadOpen)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>
                  {exporting ? "Creating image…" : "Download"}
                  <svg className={downloadOpen ? "chevron is-open" : "chevron"} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {downloadOpen && <div className="download-menu" id="download-options">
                  <p className="download-menu-heading">EXPORT YOUR PLAN</p>
                  {[
                    { format: "pdf", label: "PDF document", hint: "Print or save as PDF", badge: "PDF" },
                    { format: "png", label: "PNG image", hint: "An image to keep or share", badge: "PNG" },
                    { format: "html", label: "Offline webpage", hint: "Open in any browser", badge: "HTML" },
                  ].map(({ format, label, hint, badge }) => <button key={format} className="download-option" onClick={async () => {
                    setDownloadOpen(false); downloadButtonRef.current?.focus(); setExportError("");
                    try {
                      if (format === "pdf") { printPlan(selected); setNotice("Choose Save as PDF in the print dialog."); }
                      else if (format === "png") { setExporting(true); await downloadPlanPng(selected); setNotice("PNG download started."); }
                      else { downloadPlan(selected); setNotice("HTML download started."); }
                    } catch (error) {
                      setExportError(error instanceof Error ? error.message : "Download failed. Try another format.");
                    } finally { setExporting(false); }
                  }}><span className="format-badge">{badge}</span><span><strong>{label}</strong><small>{hint}</small></span><span className="option-arrow" aria-hidden="true">↗</span></button>)}
                </div>}
              </div>
              {exportError && <p role="alert">{exportError}</p>}</div></div>
            {conflicts.length > 0 && <div className="conflict-note" role="status"><strong>Schedule overlap</strong><p>{conflicts.join("; ")} meet at the same time. Remove a course to resolve the overlap.</p></div>}
            <div className="calendar-scroll"><div className="calendar">
              <div className="day-headings"><span aria-hidden="true">ET</span>{days.map((day) => <strong key={day}>{day}</strong>)}</div>
              <div className="calendar-body">
                <div className="time-labels">{Array.from({ length: 15 }, (_, index) => <span key={index} style={{ top: index * 60 }}>{time((index + 8) * 60)}</span>)}</div>
                {days.map((day, index) => <div className="day-column" key={day} aria-label={day}>
                  {(() => {
                    const dayEvents = events.filter((item) => item.days.includes(index)).sort((a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId));
                    const lanes: (typeof events)[] = [];
                    dayEvents.forEach((item) => {
                      const lane = lanes.find((items) => items.every((other) => item.start >= other.end || item.end <= other.start));
                      if (lane) lane.push(item); else lanes.push([item]);
                    });
                    return dayEvents.map((course) => {
                      const laneIndex = lanes.findIndex((lane) => lane.includes(course));
                      return <div key={course.eventId} className={`calendar-event ${course.color}`} style={{ top: course.start - 480, height: course.end - course.start, left: `calc(${laneIndex * 100 / lanes.length}% + 3px)`, width: `calc(${100 / lanes.length}% - 6px)` }}><button className="event-details-button" aria-label={`View details for ${course.code}, CRN ${course.crn}`} onClick={() => setDetailCourse(course)}><strong>{course.code}{course.type === "LAB" ? " · Lab" : ""}</strong><span>{time(course.start)}–{time(course.end)}</span><span className="event-title">{course.title} · {course.crn}</span></button><button className="event-remove" aria-label={`Remove ${course.code} from your plan`} title={`Remove ${course.code}`} onClick={() => remove(course)}>×</button></div>;
                    });
                  })()}
                </div>)}
                {loading && <div className="calendar-empty plan-loading" role="status"><span className="loading-bar" /><strong>Restoring your saved plan…</strong></div>}
                {!loading && selected.length === 0 && <div className="calendar-empty"><span aria-hidden="true">＋</span><strong>A week full of possibilities</strong><p>Add your first course to see it here.</p></div>}
              </div>
            </div></div>
            <div className="schedule-footer"><span className="legend-dot" /> Courses appear as you add them <span>{loading ? "Restoring plan…" : selected.length ? `${selected.length} courses in your plan` : "Let’s build your week"}</span></div>
          </section>
        </div>
      </main>
      <footer className="site-footer">
        <div className="footer-card">
          <Link href="/" className="footer-logo" aria-label="Course Planner home"><Image src="/fm-logo-navy.png" alt="Franklin & Marshall College" width={1023} height={198} /></Link>
          <div className="footer-info">
            <p>Adaptive Course Planner</p>
            <p>Spring 2027 schedule · Built by F&amp;M students</p>
            <p className="footer-motto">Lux et Lex</p>
            <p className="footer-note">A student project for planning only. Not an official Franklin &amp; Marshall College website and does not register you for courses.</p>
          </div>
        </div>
      </footer>
      {detailCourse && <CourseDetails availability={availability[detailCourse.crn]} course={detailCourse} onClose={() => setDetailCourse(null)} />}
    </>
  );
}
