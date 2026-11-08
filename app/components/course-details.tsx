"use client";

import AvailabilityStatus from "./availability-status";
import type { Availability } from "../lib/availability";
import { useEffect, useRef } from "react";
import { meeting, type Course } from "../lib/courses";

const classYears: Record<string, string> = {
  FR: "First-year students", SO: "Sophomores", JR: "Juniors", SR: "Seniors",
};

export default function CourseDetails({ course, availability, onClose, added = false, onAdd }: {
  course: Course;
  availability?: Availability;
  onClose: () => void;
  added?: boolean; // already in the student's plan
  onAdd?: () => void; // omitted while the saved plan is still loading
}) {
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
      <div className="details-topline">
        <span className={`course-code ${course.color}`}>{course.code}</span>
        <div className="details-actions">
          {(onAdd || added) && (
            <button
              className="details-add"
              disabled={added}
              aria-label={added ? `${course.code} is in your plan` : `Add ${course.code} to your plan`}
              title={added ? "In your plan" : "Add to your plan"}
              onClick={onAdd}
            >
              {added ? "✓" : "+"}
            </button>
          )}
          <button className="details-close" aria-label="Close course details" onClick={() => dialogRef.current?.close()}>×</button>
        </div>
      </div>
      <h2 id="course-details-title">{course.title}</h2>
      <p className="details-section">Spring 2027 · CRN {course.crn}{course.section ? ` · Section ${course.section}` : ""}</p>
      <p className="details-meetings">{meeting(course)}</p>
      <dl className="details-facts">
        <div><dt>Seat availability</dt><dd><AvailabilityStatus record={availability} detailed /></dd></div>
        <div><dt>Instructor</dt><dd>{course.instructors.length ? course.instructors.join("; ") : "Not listed"}</dd></div>
        <div><dt>Prerequisites</dt><dd>{course.prereq || "None listed"}</dd></div>
        <div><dt>Permission</dt><dd>{course.permission ? "Permission required" : "No permission requirement listed"}</dd></div>
        <div><dt>Registration restrictions</dt><dd>{course.closedTo.length ? `Closed to: ${course.closedTo.map((year) => classYears[year] ?? year).join(", ")}` : "None listed"}</dd></div>
      </dl>
      <p className="details-footnote">From the imported master schedule. Check with your adviser or registrar to confirm eligibility.</p>
    </dialog>
  );
}
