// GPA aggregation from Wade Fagen-Ulmschneider's UIUC GPA dataset
// (https://github.com/wadefagen/datasets/tree/main/gpa), and instructor-name matching.

import type { CourseGpa, GpaIndex, GpaStat, Section } from "./types";

export const GRADE_POINTS: Record<string, number> = {
  "A+": 4, A: 4, "A-": 3.67,
  "B+": 3.33, B: 3, "B-": 2.67,
  "C+": 2.33, C: 2, "C-": 1.67,
  "D+": 1.33, D: 1, "D-": 0.67,
  F: 0,
};

/**
 * Normalizes instructor names across sources to "last|first-initial".
 * Course Explorer: "Holder, G". GPA dataset: "Holder, Gerald W". Rate My Professors: "Gerald Holder".
 */
export function instructorKey(name: string): string {
  const n = name.trim();
  if (!n) return "";
  let last: string, first: string;
  if (n.includes(",")) {
    [last, first] = n.split(",", 2).map((x) => x.trim());
  } else {
    const parts = n.split(/\s+/);
    last = parts.pop() ?? "";
    first = parts[0] ?? "";
  }
  return `${last.toLowerCase().replace(/[^a-z\-' ]/g, "")}|${(first[0] ?? "").toLowerCase()}`;
}

export interface GpaRow {
  yearTerm: string; // 2025-sp
  year: number;
  subject: string;
  number: string;
  title: string;
  counts: Record<string, number>; // grade -> count
  instructor: string;
}

interface Acc { points: number; graded: number; a: number; terms: Set<string>; last: string; name: string }

function emptyAcc(name = ""): Acc { return { points: 0, graded: 0, a: 0, terms: new Set(), last: "", name }; }

function add(acc: Acc, row: GpaRow) {
  for (const [g, pts] of Object.entries(GRADE_POINTS)) {
    const c = row.counts[g] ?? 0;
    acc.points += c * pts;
    acc.graded += c;
    if (g.startsWith("A")) acc.a += c;
  }
  acc.terms.add(row.yearTerm);
  if (!acc.last || termRank(row.yearTerm) > termRank(acc.last)) acc.last = row.yearTerm;
}

/** "2025-fa" -> sortable number; winter < spring < summer < fall within a year. */
export function termRank(yearTerm: string): number {
  const [y, t] = yearTerm.split("-");
  return Number(y) * 10 + ({ wi: 0, sp: 1, su: 2, fa: 3 } as Record<string, number>)[t];
}

function finish(acc: Acc): GpaStat {
  return {
    gpa: acc.graded ? Math.round((acc.points / acc.graded) * 100) / 100 : 0,
    pctA: acc.graded ? Math.round((acc.a / acc.graded) * 1000) / 10 : 0,
    students: acc.graded,
    terms: acc.terms.size,
    lastTerm: acc.last,
  };
}

/** Aggregates rows from `sinceYear` on into course and course x instructor statistics. */
export function aggregateGpa(rows: GpaRow[], opts: { sinceYear: number; courses?: Set<string> }): GpaIndex {
  const byCourse = new Map<string, { course: Acc; inst: Map<string, Acc> }>();
  for (const r of rows) {
    if (r.year < opts.sinceYear) continue;
    const id = `${r.subject} ${r.number}`;
    if (opts.courses && !opts.courses.has(id)) continue;
    let e = byCourse.get(id);
    if (!e) byCourse.set(id, (e = { course: emptyAcc(), inst: new Map() }));
    add(e.course, r);
    const k = instructorKey(r.instructor);
    if (!k) continue;
    let ia = e.inst.get(k);
    if (!ia) e.inst.set(k, (ia = emptyAcc(r.instructor)));
    add(ia, r);
  }
  const out: GpaIndex = {};
  for (const [id, e] of byCourse) {
    const instructors: CourseGpa["instructors"] = {};
    for (const [k, a] of e.inst) instructors[k] = { ...finish(a), name: a.name };
    out[id] = { course: finish(e.course), instructors };
  }
  return out;
}

/** Instructors of a section that the GPA data can be looked up by (lecture-type meetings first). */
export function sectionInstructors(section: Section): string[] {
  const names = section.meetings.flatMap((m) => m.instructors);
  return [...new Set(names)];
}

/** GPA for whoever teaches this section in this course, or null when we have no history. */
export function sectionGpa(courseGpa: CourseGpa | undefined, section: Section): (GpaStat & { name: string }) | null {
  if (!courseGpa) return null;
  for (const name of sectionInstructors(section)) {
    const hit = courseGpa.instructors[instructorKey(name)];
    if (hit) return hit;
  }
  return null;
}

/** Minimal CSV line parser that handles quoted fields with commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseGpaCsv(text: string): GpaRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = (n: string) => header.indexOf(n);
  const grades = Object.keys(GRADE_POINTS);
  return lines.slice(1).map((l) => {
    const f = parseCsvLine(l);
    const counts: Record<string, number> = {};
    for (const g of grades) counts[g] = Number(f[col(g)] ?? 0);
    return {
      yearTerm: f[col("YearTerm")],
      year: Number(f[col("Year")]),
      subject: f[col("Subject")],
      number: f[col("Number")],
      title: f[col("Course Title")] ?? "",
      counts,
      instructor: f[col("Primary Instructor")] ?? "",
    };
  });
}
