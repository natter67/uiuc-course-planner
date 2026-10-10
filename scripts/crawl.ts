// Crawls Course Explorer for one term and writes data/raw/<term>.json in the RawCourse format.
//
//   tsx scripts/crawl.ts                 newest term with a published schedule
//   tsx scripts/crawl.ts 2027-spring     a specific term
//
// One XML request per subject (?mode=cascade returns every course and section), plus one
// HTML request per course for seat status, which the XML API does not include. Seat status
// is fetched only for the subjects in crawl.config.json plus every gen ed course, to keep
// the load on courses.illinois.edu low.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import type { RawCourse, RawMeeting, RawSection } from "../src/lib/normalize";

const BASE = "https://courses.illinois.edu";
const config = JSON.parse(readFileSync(new URL("./crawl.config.json", import.meta.url), "utf8")) as {
  statusSubjects: string[];
  statusForGenEds: boolean;
  concurrency: number;
  delayMs: number;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  isArray: (name) => ["cascadingCourse", "detailedSection", "meeting", "instructor", "category", "genEdAttribute", "subject", "term"].includes(name),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, tries = 3): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "uiuc-course-planner (student project; github.com)" } });
      if (r.status === 404) throw Object.assign(new Error(`404 ${url}`), { status: 404 });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.text();
    } catch (e) {
      if ((e as { status?: number }).status === 404 || i >= tries) throw e;
      await sleep(1000 * i);
    }
  }
}

/** Runs tasks with limited concurrency and a pause between requests. */
async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: config.concurrency }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        await sleep(config.delayMs);
      }
    }),
  );
  return out;
}

const text = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"]);
  return String(v).replace(/\s+/g, " ").trim();
};

async function latestTerm(): Promise<string> {
  const year = new Date().getFullYear();
  const found: string[] = [];
  for (const y of [year + 1, year]) {
    try {
      const doc = xml.parse(await get(`${BASE}/cisapp/explorer/schedule/${y}.xml`));
      for (const t of doc["ns2:calendarYear"]?.terms?.term ?? []) {
        const [season] = text(t).toLowerCase().split(" ");
        found.push(`${y}-${season}`);
      }
    } catch { /* year not published yet */ }
    if (found.length) break;
  }
  const order = { winter: 0, spring: 1, summer: 2, fall: 3 } as Record<string, number>;
  found.sort((a, b) => Number(b.slice(0, 4)) * 10 + order[b.slice(5)] - (Number(a.slice(0, 4)) * 10 + order[a.slice(5)]));
  // Skip summer/winter: students plan spring and fall.
  const t = found.find((x) => x.endsWith("spring") || x.endsWith("fall"));
  if (!t) throw new Error("No published term found");
  return t;
}

/** Converts one <cascadingCourse> to the compact RawCourse format. */
export function parseSubjectCascade(xmlText: string): Record<string, any>[] {
  return (xml.parse(xmlText)["ns2:subject"]?.cascadingCourses?.cascadingCourse ?? []) as Record<string, any>[];
}

export function toRawCourse(c: Record<string, any>, availability: Record<string, string>): RawCourse {
  const texts: string[] = [];
  const ti = (s: string) => {
    if (!s) return null;
    let k = texts.indexOf(s);
    if (k < 0) { texts.push(s); k = texts.length - 1; }
    return k;
  };
  // Restrictions published at course level apply to every section.
  const courseNotes = [text(c.sectionRegistrationNotes), text(c.sectionCappArea), text(c.sectionDeptRestriction), text(c.sectionNotes)]
    .filter(Boolean).join(" ");
  const secs: RawSection[] = (c.detailedSections?.detailedSection ?? []).map((s: Record<string, any>) => {
    const meetings: RawMeeting[] = (s.meetings?.meeting ?? []).map((m: Record<string, any>) => [
      text(m.type),
      m.type?.["@code"] ?? "",
      text(m.daysOfTheWeek),
      text(m.start),
      text(m.end),
      `${text(m.roomNumber)} ${text(m.buildingName)}`.trim(),
      (m.instructors?.instructor ?? []).map(text),
    ]);
    const crn = String(s["@id"]);
    const capp = [text(s.sectionCappArea), text(s.sectionDeptRestriction)].filter(Boolean).join(" ");
    const info = [text(s.sectionText), text(s.sectionRegistrationNotes)].filter(Boolean).join(" ");
    return [
      crn, text(s.sectionNumber), availability[crn] ?? "", text(s.partOfTerm), text(s.meetingDateRange),
      meetings, ti(capp), ti([courseNotes, text(s.sectionNotes)].filter(Boolean).join(" ")), ti(text(s.sectionCoRequest)), ti(text(s.specialApproval)), ti(info),
    ];
  });
  const genEd = (c.genEdCategories?.category ?? []).flatMap((cat: Record<string, any>) =>
    (cat["ns2:genEdAttributes"]?.genEdAttribute ?? []).map((g: Record<string, any>) => g["@code"]),
  );
  return {
    id: String(c["@id"]),
    title: text(c.label),
    hours: text(c.creditHours),
    genEd,
    degreeAttr: text(c.sectionDegreeAttributes),
    schedNote: text(c.classScheduleInformation),
    info: text(c.courseSectionInformation),
    texts,
    secs,
  };
}

/** Reads the "Availability" of each CRN from a Course Explorer course page. */
export function parseAvailability(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of parseHtml(html).querySelectorAll("tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 5) continue;
    const crn = tds[3].text.trim();
    const dts = tr.querySelectorAll("dt");
    const dt = dts.find((d) => d.text.includes("Availability"));
    const dd = dt?.nextElementSibling;
    if (/^\d{5}$/.test(crn) && dd) out[crn] = dd.text.trim();
  }
  return out;
}

async function main() {
  const term = process.argv[2] ?? (await latestTerm());
  const [year, season] = term.split("-");
  console.log(`Crawling ${term}`);

  const termDoc = xml.parse(await get(`${BASE}/cisapp/explorer/schedule/${year}/${season}.xml`));
  const subjects: string[] = (termDoc["ns2:term"]?.subjects?.subject ?? []).map((s: Record<string, any>) => s["@id"]);
  console.log(`${subjects.length} subjects`);

  const perSubject = await pool(subjects, async (subj) => {
    try {
      return parseSubjectCascade(await get(`${BASE}/cisapp/explorer/schedule/${year}/${season}/${subj}.xml?mode=cascade`));
    } catch (e) {
      console.warn(`skip ${subj}: ${(e as Error).message}`);
      return [];
    }
  });
  const all = perSubject.flat();

  const wantStatus = (c: Record<string, any>) =>
    config.statusSubjects.includes(String(c["@id"]).split(" ")[0]) || (config.statusForGenEds && !!c.genEdCategories);
  const statusTargets = all.filter(wantStatus);
  console.log(`${all.length} courses; fetching seat status for ${statusTargets.length}`);

  const availability: Record<string, string> = {};
  let done = 0;
  await pool(statusTargets, async (c) => {
    const [subj, num] = String(c["@id"]).split(" ");
    try {
      Object.assign(availability, parseAvailability(await get(`${BASE}/schedule/${year}/${season}/${subj}/${num}`)));
    } catch (e) {
      console.warn(`status ${c["@id"]}: ${(e as Error).message}`);
    }
    if (++done % 100 === 0) console.log(`  status ${done}/${statusTargets.length}`);
  });

  const courses = all.map((c) => toRawCourse(c, availability));
  mkdirSync("data/raw", { recursive: true });
  const out = `data/raw/${term}.json`;
  writeFileSync(out, JSON.stringify({ term, fetchedAt: new Date().toISOString(), courses }));
  console.log(`Wrote ${out}: ${courses.length} courses, ${courses.reduce((n, c) => n + c.secs.length, 0)} sections`);
}

if (process.argv[1]?.endsWith("crawl.ts")) main().catch((e) => { console.error(e); process.exit(1); });
