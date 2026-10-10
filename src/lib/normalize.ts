// Turns the compact "raw" course format (produced by scripts/crawl.ts, or by the
// in-browser grabber used for the sample) into the Course model.

import type { ComponentGroup, Course, Day, Meeting, PartOfTerm, SeatStatus, Section } from "./types";

/** [typeName, typeCode, days, start, end, location, instructors] */
export type RawMeeting = [string, string, string, string, string, string, string[]];
/** [crn, code, availability, partOfTerm, dateRange, meetings, capp, notes, coreq, approval, text]; the last five index into texts[] */
export type RawSection = [string, string, string, string, string, RawMeeting[], number | null, number | null, number | null, number | null, number | null];

export interface RawCourse {
  id: string;
  title: string;
  hours: string;
  genEd: string[];
  degreeAttr: string;
  schedNote: string;
  info: string;
  texts: string[];
  secs: RawSection[];
}

const LECTURE = new Set(["LEC", "LCD", "OLC", "ONL", "LCL", "LEL"]);
const DISCUSSION = new Set(["DIS", "Q", "OD", "QZ"]);
const LAB = new Set(["LAB", "OLB", "LBD", "LBL"]);

/** Which component a section type fills. Online and in-person variants share a group. */
export function groupOf(typeCode: string): ComponentGroup {
  if (LECTURE.has(typeCode)) return "lecture";
  if (DISCUSSION.has(typeCode)) return "discussion";
  if (LAB.has(typeCode)) return "lab";
  return typeCode.toLowerCase();
}

export function parseStatus(text: string): SeatStatus {
  const t = text.toLowerCase();
  if (!t) return "unknown";
  if (t.includes("closed")) return "closed";
  if (t.includes("pending")) return "pending";
  if (t.includes("restricted")) return "restricted";
  if (t.includes("open")) return "open";
  return "unknown";
}

/** "02:00PM" -> 840. Returns null for ARRANGED or anything unparseable. */
export function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

export function parseDays(d: string): Day[] {
  return [...d.trim()].filter((c): c is Day => "MTWRF".includes(c));
}

function sentences(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/(?<=\.)\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

function partOfTerm(p: string): PartOfTerm {
  return p === "A" || p === "B" ? p : "1";
}

/**
 * UIUC links sections by first letter (CHEM 102: AL1 + AQx; MATH 241: AL1 + ADx) in some
 * courses only. We treat a course as letter-linked when at least two components share
 * a first letter, e.g. lecture "A.." and discussion "A..". PHYS 212 (A1 / D2A / L1A) is not.
 */
export function detectLetterLinking(sections: Pick<Section, "code" | "group">[]): boolean {
  const lettersByGroup = new Map<string, Set<string>>();
  for (const s of sections) {
    if (!lettersByGroup.has(s.group)) lettersByGroup.set(s.group, new Set());
    lettersByGroup.get(s.group)!.add(s.code[0]?.toUpperCase() ?? "");
  }
  if (lettersByGroup.size < 2) return false;
  const counts = new Map<string, number>();
  for (const letters of lettersByGroup.values()) for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

export function normalizeCourse(raw: RawCourse): Course {
  const [subject, number] = raw.id.split(" ");
  const text = (i: number | null) => (i === null || i === undefined ? null : raw.texts[i] ?? null);
  const sections: Section[] = raw.secs.map((s) => {
    const meetings: Meeting[] = s[5].map((m) => ({
      typeName: m[0],
      typeCode: m[1],
      days: parseDays(m[2]),
      start: parseTime(m[3]),
      end: parseTime(m[4]),
      location: m[5],
      instructors: m[6],
    }));
    const typeCode = meetings[0]?.typeCode ?? "";
    return {
      crn: s[0],
      code: s[1],
      typeCode,
      group: groupOf(typeCode),
      status: parseStatus(s[2]),
      statusText: s[2],
      partOfTerm: partOfTerm(s[3]),
      dateRange: s[4],
      meetings,
      restrictions: [...sentences(text(s[6])), ...sentences(text(s[7]))],
      coRequest: text(s[8]),
      specialApproval: text(s[9]),
      sectionText: text(s[10]),
    };
  });
  const hours = raw.hours.replace(/\.$/, "").trim();
  return {
    id: raw.id,
    subject,
    number,
    title: raw.title,
    creditHours: hours,
    minHours: Number(/\d+(?:\.\d+)?/.exec(hours)?.[0] ?? 0),
    genEd: raw.genEd,
    degreeAttributes: raw.degreeAttr,
    scheduleNote: raw.schedNote,
    info: raw.info,
    linkedByLetter: detectLetterLinking(sections),
    sections,
  };
}

export function formatTime(min: number | null): string {
  if (min === null) return "arranged";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}
