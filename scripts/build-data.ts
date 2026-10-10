// Builds the static data the web app loads:
//   public/data/terms.json                       list of terms, newest first
//   public/data/<term>/index.json                one light row per course (search + GPA summary)
//   public/data/<term>/subjects/<SUBJ>.json      full courses with sections, loaded on demand
//   public/data/<term>/gpa/<SUBJ>.json           course and instructor GPA stats
//
// Usage: tsx scripts/build-data.ts data/raw/2026-fall.json [--catalog data/raw/2026-spring-catalog.json ...]
// A catalog file ({ courses: [{ id, title, hours, genEd, info }] }) from another recent term fills
// in titles, hours, gen eds and prerequisites for courses this term doesn't offer.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aggregateGpa, parseGpaCsv, type GpaRow } from "../src/lib/gpa";
import { extractPrereqText } from "../src/lib/prereqs";
import { normalizeCourse, type RawCourse } from "../src/lib/normalize";
import type { Course, GpaIndex } from "../src/lib/types";

const OUT = "public/data";
const GPA_CSV = "data/raw/uiuc-gpa-dataset.csv";
const GPA_YEARS = 5;

export interface IndexRow {
  id: string;
  title: string;
  hours: string; // "" when the course isn't offered this term
  genEd: string[];
  sections: number; // 0 when not offered this term
  open: number;
  gpa: number | null;
  pctA: number | null;
  prereq: string;
  seasons: string; // terms taught in the last 4 years of grade data, e.g. "fa sp"
  inTerm: boolean;
  /** "Restricted to ..." / "Not intended for ..." text shared by every section, if any. */
  restriction: string;
}

/** Restriction sentences that appear on every section of a course. */
function commonRestriction(c: Course): string {
  if (!c.sections.length) return "";
  const sets = c.sections.map((s) => new Set(s.restrictions.filter((r) => /^(Restricted to|Not intended for)/i.test(r))));
  const [first, ...rest] = sets;
  return [...first].filter((r) => rest.every((x) => x.has(r))).join(" ");
}

/** Which seasons each course was taught in, from grade records since `sinceYear`. */
function seasonsTaught(rows: GpaRow[], sinceYear: number): Map<string, { seasons: Set<string>; title: string }> {
  const out = new Map<string, { seasons: Set<string>; title: string }>();
  for (const r of rows) {
    if (r.year < sinceYear) continue;
    const id = `${r.subject} ${r.number}`;
    if (!out.has(id)) out.set(id, { seasons: new Set(), title: r.title });
    out.get(id)!.seasons.add(r.yearTerm.slice(5));
  }
  return out;
}
const SEASON_ORDER = ["fa", "sp", "su", "wi"];

interface CatalogCourse { id: string; title: string; hours: string; genEd: string[]; info: string }

function main(argv: string[]) {
  const files: string[] = [];
  const catalog = new Map<string, CatalogCourse>();
  let catalogTerm = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--catalog") {
      const cat = JSON.parse(readFileSync(argv[++i], "utf8")) as { term: string; courses: CatalogCourse[] };
      catalogTerm ||= cat.term;
      for (const c of cat.courses) if (!catalog.has(c.id)) catalog.set(c.id, c);
    } else files.push(argv[i]);
  }
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
    const taught = seasonsTaught(gpaRows, maxYear - 3);
    const termIds = new Set(courses.map((c) => c.id));
    const extraIds = [...new Set([...taught.keys(), ...catalog.keys()])].filter((id) => !termIds.has(id));
    const gpa: GpaIndex = aggregateGpa(gpaRows, { sinceYear: maxYear - GPA_YEARS + 1, courses: new Set([...termIds, ...extraIds]) });
    const dir = join(OUT, raw.term);
    mkdirSync(join(dir, "subjects"), { recursive: true });
    mkdirSync(join(dir, "gpa"), { recursive: true });

    const bySubject = new Map<string, Course[]>();
    for (const c of courses) {
      if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
      bySubject.get(c.subject)!.push(c);
    }
    for (const id of extraIds) {
      const subj = id.split(" ")[0];
      if (!bySubject.has(subj)) bySubject.set(subj, []);
    }
    const gpaBySubject = new Map<string, GpaIndex>();
    for (const [id, g] of Object.entries(gpa)) {
      const subj = id.split(" ")[0];
      if (!gpaBySubject.has(subj)) gpaBySubject.set(subj, {});
      gpaBySubject.get(subj)![id] = g;
    }
    for (const [subj, list] of bySubject) {
      writeFileSync(join(dir, "subjects", `${subj}.json`), JSON.stringify(list));
      writeFileSync(join(dir, "gpa", `${subj}.json`), JSON.stringify(gpaBySubject.get(subj) ?? {}));
    }

    // Seasons a course runs: grade history, plus the loaded term and the catalog term themselves.
    const termSeason = raw.term.split("-")[1].slice(0, 2);
    const catalogSeason = catalogTerm ? catalogTerm.split("-")[1].slice(0, 2) : "";
    const seasonsOf = (id: string) =>
      SEASON_ORDER.filter(
        (x) => taught.get(id)?.seasons.has(x) || (x === termSeason && termIds.has(id)) || (x === catalogSeason && catalog.has(id)),
      ).join(" ");
    const index: IndexRow[] = courses.map((c) => ({
      id: c.id,
      title: c.title,
      hours: c.creditHours,
      genEd: c.genEd,
      sections: c.sections.length,
      open: c.sections.filter((s) => s.status === "open" || s.status === "restricted").length,
      gpa: gpa[c.id]?.course.gpa ?? null,
      pctA: gpa[c.id]?.course.pctA ?? null,
      prereq: extractPrereqText(c.info),
      seasons: seasonsOf(c.id),
      inTerm: true,
      restriction: commonRestriction(c),
    }));
    // Courses not offered this term but taught recently: needed to plan later semesters.
    for (const id of extraIds) {
      const cat = catalog.get(id);
      index.push({
        id,
        title: cat?.title ?? taught.get(id)?.title ?? "",
        hours: cat?.hours.replace(/\.$/, "") ?? "",
        genEd: cat?.genEd ?? [],
        sections: 0,
        open: 0,
        gpa: gpa[id]?.course.gpa ?? null,
        pctA: gpa[id]?.course.pctA ?? null,
        prereq: cat ? extractPrereqText(cat.info) : "",
        seasons: seasonsOf(id),
        inTerm: false,
        restriction: "",
      });
    }
    index.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
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
