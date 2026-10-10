// Loads the static term data built by scripts/build-data.ts.
import type { Course, GpaIndex } from "./types";

export interface IndexRow {
  id: string;
  title: string;
  hours: string;
  genEd: string[];
  sections: number;
  open: number;
  gpa: number | null;
  pctA: number | null;
  prereq: string;
  seasons: string;
  inTerm: boolean;
  restriction: string;
}

export interface TermIndex {
  term: string;
  fetchedAt: string;
  gpaThrough: number;
  courses: IndexRow[];
}

const cache = new Map<string, Promise<unknown>>();
function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(url) as Promise<T>;
}

export const loadTerms = () => getJson<string[]>("/data/terms.json");
export const loadIndex = (term: string) => getJson<TermIndex>(`/data/${term}/index.json`);

/** Full course data (sections) and GPA for the subjects of the given course ids. */
export async function loadCourses(term: string, ids: string[]): Promise<{ courses: Course[]; gpa: GpaIndex }> {
  const subjects = [...new Set(ids.map((id) => id.split(" ")[0]))];
  const parts = await Promise.all(
    subjects.map(async (s) => {
      const [courses, gpa] = await Promise.all([
        getJson<Course[]>(`/data/${term}/subjects/${s}.json`),
        getJson<GpaIndex>(`/data/${term}/gpa/${s}.json`).catch(() => ({}) as GpaIndex),
      ]);
      return { courses, gpa };
    }),
  );
  const wanted = new Set(ids);
  return {
    courses: parts.flatMap((p) => p.courses).filter((c) => wanted.has(c.id)),
    gpa: Object.assign({}, ...parts.map((p) => p.gpa)),
  };
}

export function termLabel(term: string): string {
  const [y, s] = term.split("-");
  return `${s[0].toUpperCase()}${s.slice(1)} ${y}`;
}

/** Rate My Professors school id for UIUC. Verify on ratemyprofessors.com before relying on it. */
export const RMP_SCHOOL_ID = "1112";
export function rmpSearchUrl(name: string): string {
  const [last, first] = name.split(",").map((x) => x.trim());
  const q = first ? `${first.split(" ")[0]} ${last}` : last;
  return `https://www.ratemyprofessors.com/search/professors/${RMP_SCHOOL_ID}?q=${encodeURIComponent(q)}`;
}

export const GEN_ED_LABELS: Record<string, string> = {
  "1CLL": "Advanced Composition",
  "1FC1": "Composition I",
  "1HP": "Humanities: Hist & Phil",
  "1LA": "Humanities: Lit & Arts",
  "1SS": "Social Sciences",
  "1BSC": "Behavioral Sciences",
  "1LS": "Life Sciences",
  "1PS": "Physical Sciences",
  "1QR1": "Quant Reasoning I",
  "1QR2": "Quant Reasoning II",
  "1WCC": "Western Culture",
  "1NW": "Non-Western Culture",
  "1US": "US Minority Culture",
};
