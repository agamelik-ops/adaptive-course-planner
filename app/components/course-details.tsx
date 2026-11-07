"use client";

import { useEffect, useRef } from "react";
import { meeting, type Course } from "../lib/courses";

const classYears: Record<string, string> = {
  FR: "First-year students", SO: "Sophomores", JR: "Juniors", SR: "Seniors",
};

export default function CourseDetails({ course, onClose }: { course: Course; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="course-details" aria-labelledby="course-details-title" onClose={(event) => {
      // Strict Mode replays the effect (open → close → open). Ignore the
      // queued close event from that replay if the dialog is open again.
      if (!event.currentTarget.open) onClose();
    }} onClick={(event) => {
      if (event.target === event.currentTarget) {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close();
      }
    }}>
      <div className="details-topline"><span className={`course-code ${course.color}`}>{course.code}</span><button className="details-close" aria-label="Close course details" onClick={() => dialogRef.current?.close()}>×</button></div>
      <h2 id="course-details-title">{course.title}</h2>
      <p className="details-section">Spring 2027 · CRN {course.crn}{course.section ? ` · Section ${course.section}` : ""}</p>
      <p className="details-meetings">{meeting(course)}</p>
      <dl className="details-facts">
        <div><dt>Instructor</dt><dd>{course.instructors.length ? course.instructors.join("; ") : "Not listed"}</dd></div>
        <div><dt>Prerequisites</dt><dd>{course.prereq || "None listed"}</dd></div>
        <div><dt>Permission</dt><dd>{course.permission ? "Permission required" : "No permission requirement listed"}</dd></div>
        <div><dt>Registration restrictions</dt><dd>{course.closedTo.length ? `Closed to: ${course.closedTo.map((year) => classYears[year] ?? year).join(", ")}` : "None listed"}</dd></div>
      </dl>
      <p className="details-footnote">From the imported master schedule. Check with your adviser or registrar to confirm eligibility.</p>
    </dialog>
  );
}
