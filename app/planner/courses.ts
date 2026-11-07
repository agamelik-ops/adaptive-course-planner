// Spring 2027 sections, generated from the registrar's Master Schedule PDF by
// scripts/parse_schedule.py. Re-run that script when a new PDF comes out
// instead of editing courses.json by hand.
import data from "./courses.json";

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

export type Meeting = {
  type: string; // "CLAS" or "LAB"
  days: Day[];
  start: string; // 24h "HH:MM"
  end: string; // 24h "HH:MM"
};

export type Course = {
  crn: string;
  code: string; // e.g. "CPS 111"
  section: string;
  title: string;
  instructors: string[];
  dist: string[]; // gen-ed / program tags, e.g. ["NATL"]
  closedTo: string[]; // class years that can't register, e.g. ["FR", "SO"]
  prereq: string;
  permission: boolean;
  crossListed: boolean;
  description: string;
  meetings: Meeting[]; // empty = time TBA (private lessons, ensembles, etc.)
};

export const COURSES = data as Course[];

const BY_CRN = new Map(COURSES.map((c) => [c.crn, c]));

export function findCourse(crn: string): Course | undefined {
  return BY_CRN.get(crn.trim());
}
