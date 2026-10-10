// Builds the static data the web app loads:
//   public/data/terms.json                       list of terms, newest first
//   public/data/<term>/index.json                one light row per course (search + GPA summary)
//   public/data/<term>/subjects/<SUBJ>.json      full courses with sections, loaded on demand
//   public/data/<term>/gpa/<SUBJ>.json           course and instructor GPA stats
//
// Usage: tsx scripts/build-data.ts data/raw/2026-fall.json [more raw term files...]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aggregateGpa, parseGpaCsv } from "../src/lib/gpa";
import { normalizeCourse, type RawCourse } from "../src/lib/normalize";
import type { Course, GpaIndex } from "../src/lib/types";

const OUT = "public/data";
const GPA_CSV = "data/raw/uiuc-gpa-dataset.csv";
const GPA_YEARS = 5;

export interface IndexRow {
  id: string;
  title: string;
  hours: string;
  genEd: string[];
  sections: number;
  open: number;
  gpa: number | null;
  pctA: number | null;
}

function main(files: string[]) {
  if (!files.length) {
    console.error("usage: tsx scripts/build-data.ts <raw term json>...");
    process.exit(1);
  }
  const gpaRows = existsSync(GPA_CSV) ? parseGpaCsv(readFileSync(GPA_CSV, "utf8")) : [];
  const maxYear = gpaRows.reduce((m, r) => Math.max(m, r.year), 0);
  if (!gpaRows.length) console.warn(`No ${GPA_CSV}; GPA data will be empty.`);

  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { term: string; fetchedAt: string; courses: RawCourse[] };
    const courses: Course[] = raw.courses.map(normalizeCourse);
    const gpa: GpaIndex = aggregateGpa(gpaRows, { sinceYear: maxYear - GPA_YEARS + 1, courses: new Set(courses.map((c) => c.id)) });
    const dir = join(OUT, raw.term);
    mkdirSync(join(dir, "subjects"), { recursive: true });
    mkdirSync(join(dir, "gpa"), { recursive: true });

    const bySubject = new Map<string, Course[]>();
    for (const c of courses) {
      if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
      bySubject.get(c.subject)!.push(c);
    }
    for (const [subj, list] of bySubject) {
      writeFileSync(join(dir, "subjects", `${subj}.json`), JSON.stringify(list));
      const g: GpaIndex = {};
      for (const c of list) if (gpa[c.id]) g[c.id] = gpa[c.id];
      writeFileSync(join(dir, "gpa", `${subj}.json`), JSON.stringify(g));
    }

    const index: IndexRow[] = courses.map((c) => ({
      id: c.id,
      title: c.title,
      hours: c.creditHours,
      genEd: c.genEd,
      sections: c.sections.length,
      open: c.sections.filter((s) => s.status === "open" || s.status === "restricted").length,
      gpa: gpa[c.id]?.course.gpa ?? null,
      pctA: gpa[c.id]?.course.pctA ?? null,
    }));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ term: raw.term, fetchedAt: raw.fetchedAt, gpaThrough: maxYear, courses: index }));
    console.log(`${raw.term}: ${courses.length} courses, ${bySubject.size} subjects, GPA for ${Object.keys(gpa).length}`);
  }

  const terms = readdirSync(OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(OUT, d.name, "index.json")))
    .map((d) => d.name)
    .sort(termOrder);
  writeFileSync(join(OUT, "terms.json"), JSON.stringify(terms));
}

/** Newest first: 2027-spring before 2026-fall before 2026-summer. */
export function termOrder(a: string, b: string): number {
  const rank = (t: string) => {
    const [y, s] = t.split("-");
    return Number(y) * 10 + ({ spring: 1, summer: 2, fall: 3, winter: 0 } as Record<string, number>)[s] ;
  };
  return rank(b) - rank(a);
}

main(process.argv.slice(2));
