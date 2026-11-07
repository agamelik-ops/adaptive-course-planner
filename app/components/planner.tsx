"use client";

import Link from "next/link";
import { useState } from "react";
import { meeting, overlaps, searchCourses, time, type Course } from "../lib/courses";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function Planner() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Course[]>([]);
  const [notice, setNotice] = useState("");
  const results = searchCourses(query);
  const conflicts = selected.flatMap((course, index) =>
    selected.slice(index + 1).filter((other) => overlaps(course, other)).map((other) => `${course.code} and ${other.code}`),
  );

  function add(course: Course) {
    setSelected((current) => current.some((item) => item.crn === course.crn) ? current : [...current, course]);
    setNotice(`${course.code} added to your plan.`);
  }

  return (
    <>
      <header className="site-header">
        <Link href="/" className="wordmark">F&M <span>FRANKLIN & MARSHALL<br />COURSE PLANNER</span></Link>
        <span className="header-tag">A little planning. A lot of possibility.</span>
      </header>
      <main className="planner-shell">
        <div className="page-heading"><div><p className="eyebrow">YOUR NEXT CHAPTER</p><h1>Make room for what’s next.</h1><p>Find your classes. Build your week. See the possibilities.</p></div><span className="demo-badge">Sample catalog</span></div>
        <p className="demo-note">Explore with demonstration courses. CRNs, offerings, and meeting times are illustrative; this is not registration. Your plan lasts until you refresh.</p>
        <div className="planner-layout">
          <aside className="sidebar">
            <section className="panel search-panel" aria-labelledby="find-heading">
              <div className="section-title"><h2 id="find-heading">Find a course</h2><span>01</span></div>
              <label htmlFor="course-search">Search by name, subject, code, or CRN</label>
              <div className="search-input"><span aria-hidden="true">⌕</span><input id="course-search" type="search" placeholder="Try economics, CPS 111, or 10001" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              <p className="result-count" role="status">{results.length} {results.length === 1 ? "course" : "courses"} {query.trim() ? "found" : "to explore"}</p>
              <ul className="course-results">
                {results.map((course) => {
                  const added = selected.some((item) => item.crn === course.crn);
                  return <li key={course.crn} className="course-result"><div><span className={`course-code ${course.color}`}>{course.code}</span><h3>{course.title}</h3><p>{meeting(course)}</p><p>CRN {course.crn} · {course.credits} credit</p></div><button className="add-button" disabled={added} aria-label={added ? `${course.code} already added` : `Add ${course.code}: ${course.title}`} onClick={() => add(course)}>{added ? "✓" : "+"}</button></li>;
                })}
              </ul>
              {results.length === 0 && <div className="no-results"><h3>No matching courses</h3><p>Try a broader subject, a course title, or a CRN.</p><button onClick={() => setQuery("")}>Clear search</button></div>}
            </section>
            <section className="panel selected-panel" aria-labelledby="selected-heading">
              <div className="section-title"><h2 id="selected-heading">Your courses</h2><span>02</span></div>
              <div className="plan-totals"><strong>{selected.length} courses</strong><span>{selected.reduce((sum, course) => sum + course.credits, 0)} credits</span></div>
              {selected.length === 0 ? <p className="empty-selection">Your week is a blank canvas. Add a course above to get started.</p> : <ul className="selected-list">{selected.map((course) => <li key={course.crn} className={`selected-course ${course.color}`}><div><strong>{course.code}</strong><span>{course.title}</span></div><button aria-label={`Remove ${course.code}`} onClick={() => { setSelected((current) => current.filter((item) => item.crn !== course.crn)); setNotice(`${course.code} removed from your plan.`); }}>×</button></li>)}</ul>}
              <p className="sr-only" role="status">{notice}</p>
            </section>
          </aside>
          <section className="panel schedule-panel" aria-labelledby="schedule-heading">
            <div className="schedule-heading"><div><p className="eyebrow">THE BIG PICTURE</p><h2 id="schedule-heading">Your weekly schedule</h2></div><span className="week-label">Monday — Friday</span></div>
            {conflicts.length > 0 && <div className="conflict-note" role="status"><strong>Schedule overlap</strong><p>{conflicts.join("; ")} meet at the same time. Remove a course to resolve the overlap.</p></div>}
            <div className="calendar-scroll"><div className="calendar">
              <div className="day-headings"><span aria-hidden="true">EST</span>{days.map((day) => <strong key={day}>{day}</strong>)}</div>
              <div className="calendar-body">
                <div className="time-labels">{Array.from({ length: 13 }, (_, index) => <span key={index} style={{ top: index * 60 }}>{time((index + 8) * 60)}</span>)}</div>
                {days.map((day, index) => <div className="day-column" key={day} aria-label={day}>
                  {selected.filter((course) => course.days.includes(index)).map((course) => {
                    const dayCourses = selected.filter((item) => item.days.includes(index)).sort((a, b) => a.start - b.start || a.crn.localeCompare(b.crn));
                    // Give overlapping meetings separate lanes so both remain readable.
                    const lanes: Course[][] = [];
                    dayCourses.forEach((item) => { const lane = lanes.find((items) => items.every((other) => !overlaps(item, other))); if (lane) lane.push(item); else lanes.push([item]); });
                    const laneIndex = lanes.findIndex((lane) => lane.includes(course));
                    return <div key={course.crn} className={`calendar-event ${course.color}`} style={{ top: course.start - 480, height: course.end - course.start, left: `calc(${laneIndex * 100 / lanes.length}% + 3px)`, width: `calc(${100 / lanes.length}% - 6px)` }}><strong>{course.code}</strong><span>{time(course.start)}–{time(course.end)}</span><span className="event-title">{course.title}</span></div>;
                  })}
                </div>)}
                {selected.length === 0 && <div className="calendar-empty"><span aria-hidden="true">＋</span><strong>A week full of possibilities</strong><p>Add your first course to see it here.</p></div>}
              </div>
            </div></div>
            <div className="schedule-footer"><span className="legend-dot" /> Courses appear as you add them <span>{selected.length ? `${selected.length} courses in your plan` : "Let’s build your week"}</span></div>
          </section>
        </div>
        <footer className="page-footer"><span>Adaptive Course Planner · Made for your next chapter.</span><nav aria-label="Team pages"><Link href="/planner">Registrar planner</Link><span>Team workspace</span><Link href="/alex">Alex</Link><Link href="/jason">Jason</Link><Link href="/wesley">Wesley</Link></nav></footer>
      </main>
    </>
  );
}
