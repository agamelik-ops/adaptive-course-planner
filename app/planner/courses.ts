// SAMPLE DATA ONLY — placeholder courses so the planner works before we
// connect real F&M course data. CRNs, titles, and times here are made up.

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

export type Meeting = {
  days: Day[];
  start: string; // 24h "HH:MM"
  end: string; // 24h "HH:MM"
};

export type Course = {
  crn: string;
  code: string;
  title: string;
  instructor: string;
  location: string;
  meetings: Meeting[];
};

export const SAMPLE_COURSES: Course[] = [
  {
    crn: "10060",
    code: "CPS 111",
    title: "Computer Science I",
    instructor: "Staff",
    location: "Stager 101",
    meetings: [{ days: ["Mon", "Wed", "Fri"], start: "09:00", end: "09:50" }],
  },
  {
    crn: "10061",
    code: "MAT 109",
    title: "Calculus I",
    instructor: "Staff",
    location: "Stager 210",
    meetings: [{ days: ["Mon", "Wed", "Fri"], start: "11:00", end: "11:50" }],
  },
  {
    crn: "10062",
    code: "ENG 135",
    title: "Intro to Creative Writing",
    instructor: "Staff",
    location: "Keiper 120",
    meetings: [{ days: ["Tue", "Thu"], start: "10:00", end: "11:20" }],
  },
  {
    crn: "10063",
    code: "BIO 110",
    title: "Principles of Evolution",
    instructor: "Staff",
    location: "LSP 150",
    meetings: [
      { days: ["Tue", "Thu"], start: "13:30", end: "14:50" },
      { days: ["Wed"], start: "14:00", end: "16:50" },
    ],
  },
  {
    crn: "10064",
    code: "ECO 100",
    title: "Introduction to Economic Principles",
    instructor: "Staff",
    location: "Harris 201",
    meetings: [{ days: ["Mon", "Wed"], start: "13:00", end: "14:20" }],
  },
  {
    crn: "10065",
    code: "PSY 100",
    title: "Introduction to Psychology",
    instructor: "Staff",
    location: "Steinman 110",
    meetings: [{ days: ["Tue", "Thu"], start: "09:00", end: "10:20" }],
  },
  {
    crn: "10066",
    code: "MUS 101",
    title: "Music Theory I",
    instructor: "Staff",
    location: "Steinman 210",
    meetings: [{ days: ["Mon"], start: "19:00", end: "21:50" }],
  },
];

export function findCourse(crn: string): Course | undefined {
  return SAMPLE_COURSES.find((c) => c.crn === crn.trim());
}
