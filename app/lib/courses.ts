// Demonstration data only. Replace with an official, term-specific catalog feed.
export type Course = {
  crn: string;
  code: string;
  subject: string;
  title: string;
  days: number[];
  start: number;
  end: number;
  credits: number;
  color: string;
};

export const courses: Course[] = [
  { crn: "10001", code: "ECO 100", subject: "Economics", title: "Introduction to Economics", days: [0, 2, 4], start: 540, end: 590, credits: 1, color: "gold" },
  { crn: "10002", code: "ECO 201", subject: "Economics", title: "Microeconomic Theory", days: [0, 2], start: 780, end: 860, credits: 1, color: "gold" },
  { crn: "10003", code: "CPS 111", subject: "Computer Science", title: "Introduction to Computer Science", days: [1, 3], start: 600, end: 680, credits: 1, color: "blue" },
  { crn: "10004", code: "CPS 377", subject: "Computer Science", title: "Database Systems", days: [1, 3], start: 780, end: 860, credits: 1, color: "blue" },
  { crn: "10005", code: "JPN 221", subject: "Japanese", title: "Intermediate Japanese", days: [0, 2], start: 870, end: 950, credits: 1, color: "purple" },
  { crn: "10006", code: "MAT 109", subject: "Mathematics", title: "Calculus I", days: [0, 2, 4], start: 600, end: 650, credits: 1, color: "green" },
  { crn: "10007", code: "PSY 100", subject: "Psychology", title: "Introductory Psychology", days: [1, 3], start: 600, end: 680, credits: 1, color: "rose" },
  { crn: "10008", code: "ENG 100", subject: "English", title: "Introduction to Literary Studies", days: [0, 2, 4], start: 660, end: 710, credits: 1, color: "sand" },
];

export function searchCourses(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return courses.filter((course) => {
    const fields = `${course.crn} ${course.code} ${course.code.replace(/\s/g, "")} ${course.subject} ${course.title}`.toLowerCase();
    return terms.every((term) => fields.includes(term));
  });
}

export function overlaps(a: Course, b: Course) {
  return a.days.some((day) => b.days.includes(day)) && a.start < b.end && b.start < a.end;
}

export function time(minutes: number) {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")}${hour >= 12 ? "pm" : "am"}`;
}

export function meeting(course: Course) {
  return `${course.days.map((day) => ["Mon", "Tue", "Wed", "Thu", "Fri"][day]).join(" / ")} · ${time(course.start)}–${time(course.end)}`;
}
