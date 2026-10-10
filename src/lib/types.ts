// Core data model shared by the crawler, the solver and the UI.

export type Day = "M" | "T" | "W" | "R" | "F";
export const DAYS: Day[] = ["M", "T", "W", "R", "F"];

/** Open/closed state as Course Explorer shows it on the course page. */
export type SeatStatus = "open" | "restricted" | "closed" | "pending" | "unknown";

/** Which part of the semester a section runs in: full term, first 8 weeks (A) or second 8 weeks (B). */
export type PartOfTerm = "1" | "A" | "B";

export interface Meeting {
  typeCode: string; // LEC, DIS, LAB, LCD, Q, ONL ...
  typeName: string;
  days: Day[]; // empty for online / arranged
  start: number | null; // minutes after midnight, null when ARRANGED
  end: number | null;
  location: string;
  instructors: string[]; // "Last, F" as Course Explorer prints it
}

export interface Section {
  crn: string;
  code: string; // section number, e.g. AL1, ADB, D2A
  typeCode: string; // type of the first meeting
  group: ComponentGroup; // which component this section fills
  status: SeatStatus;
  statusText: string;
  partOfTerm: PartOfTerm;
  dateRange: string;
  meetings: Meeting[];
  /** Restriction text from sectionCappArea and sectionNotes. */
  restrictions: string[];
  coRequest: string | null;
  specialApproval: string | null;
  sectionText: string | null;
}

/** Sections of one course split into the components a student must take one of each. */
export type ComponentGroup = "lecture" | "discussion" | "lab" | string;

export interface Course {
  id: string; // "PHYS 212"
  subject: string;
  number: string;
  title: string;
  creditHours: string; // "3 hours" or "1 TO 4 hours"
  minHours: number;
  genEd: string[]; // gen ed attribute codes, e.g. 1HP, 1QR2
  degreeAttributes: string;
  scheduleNote: string; // classScheduleInformation: often explains linking
  info: string; // courseSectionInformation: prereqs, credit notes
  /** True when sections link by shared first letter (AL1 goes with AD*, not BD*). */
  linkedByLetter: boolean;
  sections: Section[];
}

export interface TermData {
  term: string; // "2026-fall"
  fetchedAt: string;
  courses: Course[];
}

/** Grade statistics for one course, or one instructor teaching it. */
export interface GpaStat {
  gpa: number;
  pctA: number; // share of A+, A, A-
  students: number;
  terms: number;
  lastTerm: string; // e.g. 2025-sp
}

export interface CourseGpa {
  course: GpaStat;
  /** Keyed by instructorKey(): "holder|g". */
  instructors: Record<string, GpaStat & { name: string }>;
}

export type GpaIndex = Record<string, CourseGpa>; // keyed by course id "PHYS 212"
