import data from "../planner/courses.json";

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

type RawMeeting = {
  type: string;
  days: Day[];
  start: string;
  end: string;
};

type RawCourse = {
  crn: string;
  code: string;
  section: string;
  title: string;
  instructors: string[];
  dist: string[];
  closedTo: string[];
  prereq: string;
  permission: boolean;
  crossListed: boolean;
  description: string;
  meetings: RawMeeting[];
};

export type Meeting = {
  type: string;
  days: number[];
  start: number;
  end: number;
};

export type Course = Omit<RawCourse, "meetings"> & {
  meetings: Meeting[];
  color: string;
  subject: string;
};

const weekdays: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const colors = [
  "gold",
  "blue",
  "purple",
  "green",
  "rose",
  "sand"
];

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export const COURSES: Course[] = (data as RawCourse[]).map(
  (course, index) => ({
    ...course,
    subject: course.code.trim().split(/\s+/)[0],
    color: colors[index % colors.length],
    meetings: course.meetings.map((item) => ({
      ...item,
      days: item.days.map((day) => weekdays.indexOf(day)),
      start: toMinutes(item.start),
      end: toMinutes(item.end)
    }))
  })
);

// Compatibility with existing advisor and saved-plan imports.
export { COURSES as courses };

const BY_CRN = new Map(
  COURSES.map((course) => [course.crn, course])
);

export function findCourse(crn: string): Course | undefined {
  return BY_CRN.get(crn.trim());
}

export function searchCourses(query: string): Course[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) return COURSES;

  return COURSES.filter((course) => {
    const searchable = [
      course.code,
      course.title,
      course.crn,
      ...course.instructors,
      ...course.dist
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
}

export function time(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${hours % 12 || 12}:${String(mins).padStart(2, "0")}${
    hours >= 12 ? "pm" : "am"
  }`;
}

export function meeting(course: Course): string {
  if (!course.meetings.length) return "Meeting time TBA";

  return course.meetings
    .map((item) => {
      const days = item.days.map((day) => weekdays[day]).join("/");
      const label = item.type === "LAB" ? "Lab · " : "";

      return `${label}${days} ${time(item.start)}–${time(item.end)}`;
    })
    .join("; ");
}

export function overlaps(first: Course, second: Course): boolean {
  return first.meetings.some((a) =>
    second.meetings.some(
      (b) =>
        a.days.some((day) => b.days.includes(day)) &&
        a.start < b.end &&
        b.start < a.end
    )
  );
}
export const subjects: Record<string, string> = Object.fromEntries(
  [...new Set(COURSES.map((course) => course.subject))]
    .sort()
    .map((subject) => [subject, subject])
);