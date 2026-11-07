import { COURSES } from "../planner/courses";

export type Meeting = { days: number[]; start: number; end: number; type: string };
export type Course = {
  crn: string;
  code: string;
  section: string;
  subject: string;
  title: string;
  meetings: Meeting[];
  color: string;
};

const subjects: Record<string, string> = {
  AFS: "Africana Studies", AMS: "American Studies", ANT: "Anthropology",
  ART: "Art", AST: "Astronomy", BIO: "Biology", BOS: "Business Organizations and Society",
  CHM: "Chemistry", CHN: "Chinese", CLS: "Classics", CPS: "Computer Science",
  DSC: "Data Science", ECO: "Economics", ENE: "Environmental Studies", ENG: "English",
  FLM: "Film", FRN: "French", GER: "German", GOV: "Government", GRK: "Greek",
  GST: "Global Studies", HAA: "History of Art and Architecture", HIS: "History",
  INT: "Interdisciplinary", IST: "International Studies", ITA: "Italian", JPN: "Japanese",
  JST: "Judaic Studies", LAT: "Latin", LIN: "Linguistics", LIT: "Literature",
  MAT: "Mathematics", MUS: "Music", NSP: "Neuroscience", PBH: "Public Health",
  PHI: "Philosophy", PHY: "Physics", PSY: "Psychology", RST: "Religious Studies",
  RUS: "Russian", SOC: "Sociology", SPA: "Spanish", SPM: "Spanish", STS: "Science Technology and Society",
  TND: "Theatre and Dance", WGS: "Women's Gender and Sexuality Studies",
};
const languages = new Set(["CHN", "FRN", "GER", "GRK", "ITA", "JPN", "LAT", "RUS", "SPA", "SPM"]);
const colors = ["gold", "blue", "purple", "green", "rose", "sand"];
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export const courses: Course[] = COURSES.map((course) => {
  const prefix = course.code.split(" ")[0];
  return {
    crn: course.crn, code: course.code, section: course.section,
    subject: subjects[prefix] ?? prefix, title: course.title,
    color: colors[Object.keys(subjects).indexOf(prefix) % colors.length] ?? "blue",
    meetings: course.meetings.map((item) => ({
      type: item.type, days: item.days.map((day) => dayNames.indexOf(day)).filter((day) => day >= 0),
      start: minutes(item.start), end: minutes(item.end),
    })),
  };
});

export function searchCourses(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return courses.filter((course) => {
    const category = languages.has(course.code.split(" ")[0]) ? "language languages" : "";
    const fields = `${course.crn} ${course.code} ${course.code.replace(/\s/g, "")} ${course.subject} ${course.title} ${category}`.toLowerCase();
    return terms.every((term) => fields.includes(term));
  });
}

export function overlaps(a: Course, b: Course) {
  return a.meetings.some((first) => b.meetings.some((second) =>
    first.days.some((day) => second.days.includes(day)) && first.start < second.end && second.start < first.end,
  ));
}

export function time(value: number) {
  const hour = Math.floor(value / 60);
  return `${hour % 12 || 12}:${String(value % 60).padStart(2, "0")}${hour >= 12 ? "pm" : "am"}`;
}

export function meeting(course: Course) {
  return course.meetings.length ? course.meetings.map((item) =>
    `${item.type === "LAB" ? "Lab: " : ""}${item.days.map((day) => dayNames[day]).join(" / ")} · ${time(item.start)}–${time(item.end)}`,
  ).join("; ") : "Meeting time TBA";
}
