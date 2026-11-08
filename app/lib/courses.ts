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

// Full subject names so searches like "Spanish" or "computer science" work,
// and so the assistant can recognize a major the student types.
const SUBJECT_NAMES: Record<string, string> = {
  AFS: "Africana Studies", AMS: "American Studies", ANT: "Anthropology",
  ART: "Art", AST: "Astronomy", BIO: "Biology", BOS: "Business Organizations and Society",
  CHM: "Chemistry", CHN: "Chinese", CLS: "Classics", CPS: "Computer Science",
  DSC: "Data Science", ECO: "Economics", ENE: "Earth and Environment", ENG: "English",
  FLM: "Film", FRN: "French", GER: "German", GOV: "Government", GRK: "Greek",
  GST: "Global Studies", HAA: "History of Art and Architecture", HIS: "History",
  INT: "Interdepartmental", IST: "International Studies", ITA: "Italian", JPN: "Japanese",
  JST: "Judaic Studies", LAT: "Latin", LIN: "Linguistics", LIT: "Comparative Literary Studies",
  MAT: "Mathematics", MUS: "Music", NSP: "Natural Science in Perspective", PBH: "Public Health",
  PHI: "Philosophy", PHY: "Physics", PSY: "Psychology", RST: "Religious Studies",
  RUS: "Russian", SOC: "Sociology", SPA: "Spanish", SPM: "Cognitive Science and Moral Psychology",
  STS: "Science Technology and Society", TND: "Theatre and Dance", WGS: "Women's Gender and Sexuality Studies",
};
const LANGUAGE_PREFIXES = new Set(["CHN", "FRN", "GER", "GRK", "ITA", "JPN", "LAT", "RUS", "SPA"]);

// Lowercase, strip accents and punctuation so "Caamaño", "caamano" and "Shelton, Laura" all match.
function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9&\s]/g, " ");
}

export function searchCourses(query: string): Course[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);

  if (!terms.length) return COURSES;

  return COURSES.filter((course) => {
    const searchable = normalize([
      course.crn,
      course.code,
      course.code.replace(/\s/g, ""),
      SUBJECT_NAMES[course.subject] ?? "",
      course.title,
      ...course.instructors,
      ...course.dist,
      LANGUAGE_PREFIXES.has(course.subject) ? "language languages" : "",
    ].join(" "));

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
    .map((subject) => [subject, SUBJECT_NAMES[subject] ?? subject])
);