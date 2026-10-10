import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregateGpa, instructorKey, parseCsvLine, termRank } from "../src/lib/gpa";
import { detectLetterLinking, normalizeCourse, parseTime, type RawCourse } from "../src/lib/normalize";
import { DEFAULT_PROFILE, evaluateAccess } from "../src/lib/restrictions";
import { buildOptions, DEFAULT_PREFS, overlaps, sectionMask, solve, findReplacement, type Preferences } from "../src/lib/solver";
import type { Course, Section } from "../src/lib/types";

const raw = JSON.parse(readFileSync("data/raw/2026-fall-sample.json", "utf8")) as { courses: RawCourse[] };
const courses = raw.courses.map(normalizeCourse);
const catalog = new Map<string, Course>(courses.map((c) => [c.id, c]));
const get = (id: string) => catalog.get(id)!;
const prefs = (p: Partial<Preferences> = {}): Preferences => ({ ...DEFAULT_PREFS, ...p });

describe("normalize", () => {
  it("parses times", () => {
    expect(parseTime("02:00PM")).toBe(840);
    expect(parseTime("12:30PM")).toBe(750);
    expect(parseTime("12:00AM")).toBe(0);
    expect(parseTime("ARRANGED")).toBeNull();
  });

  it("detects first-letter linking only where Course Explorer uses it", () => {
    expect(get("CHEM 102").linkedByLetter).toBe(true); // AL1 + AQx
    expect(get("MATH 241").linkedByLetter).toBe(true); // AL1 + ADx
    expect(get("PHYS 212").linkedByLetter).toBe(false); // A1 / D2A
    expect(detectLetterLinking([{ code: "A1", group: "lecture" }, { code: "D2A", group: "discussion" }])).toBe(false);
  });

  it("maps seat status text", () => {
    const statuses = new Set(courses.flatMap((c) => c.sections.map((s) => s.status)));
    expect(statuses.has("closed")).toBe(true);
    expect(statuses.has("restricted")).toBe(true);
    expect(statuses.has("unknown")).toBe(false);
  });
});

describe("restrictions", () => {
  const sec = (restrictions: string[], extra: Partial<Section> = {}): Section => ({
    ...get("PHYS 212").sections[0], restrictions, coRequest: null, specialApproval: null, status: "open", ...extra,
  });
  it("blocks sections not intended for engineering students", () => {
    expect(evaluateAccess(sec(["Not intended for Engineering."]), DEFAULT_PROFILE).access).toBe("blocked");
    expect(evaluateAccess(sec(["Not intended for Graduate - Urbana-Champaign."]), DEFAULT_PROFILE).access).toBe("ok");
  });
  it("blocks sections restricted to other majors, allows our own", () => {
    expect(evaluateAccess(sec(["Restricted to Physics or Computer Science and Physics major(s)."]), DEFAULT_PROFILE).access).toBe("blocked");
    expect(evaluateAccess(sec(["Restricted to Materials Science and Engineering major(s)."]), DEFAULT_PROFILE).access).toBe("ok");
    expect(evaluateAccess(sec(["Restricted to First Time Freshman students."]), DEFAULT_PROFILE).access).toBe("blocked");
    expect(evaluateAccess(sec(["Restricted to First Time Freshman students."]), { ...DEFAULT_PROFILE, standing: "Freshman" }).access).toBe("ok");
  });
  it("treats paired and approval-only sections as blocked", () => {
    expect(evaluateAccess(sec([], { coRequest: "Must enroll concurrently in MATH 199 22231." }), DEFAULT_PROFILE).access).toBe("blocked");
    expect(evaluateAccess(sec([], { specialApproval: "Departmental Approval Required" }), DEFAULT_PROFILE).access).toBe("blocked");
  });
});

describe("options", () => {
  it("pairs CHEM 102 lectures only with quizzes of the same letter", () => {
    const { options } = buildOptions(get("CHEM 102"), DEFAULT_PROFILE, prefs({ includeClosed: true }), {});
    expect(options.length).toBeGreaterThan(0);
    for (const o of [...options, ...options.flatMap((x) => x.sameTime)]) {
      const letters = new Set(o.sections.map((s) => s.code[0]));
      expect(letters.size).toBe(1);
    }
  });

  it("takes one section from every component", () => {
    const course = get("PHYS 212");
    const groups = new Set(course.sections.map((s) => s.group));
    const { options } = buildOptions(course, DEFAULT_PROFILE, prefs(), {});
    for (const o of options) expect(new Set(o.sections.map((s) => s.group))).toEqual(groups);
  });

  it("explains why a course has no options", () => {
    const { options, reason } = buildOptions(get("PHYS 212"), DEFAULT_PROFILE, prefs({ daysOff: ["M", "T", "W", "R", "F"] }), {});
    expect(options).toHaveLength(0);
    expect(reason).toMatch(/day off/);
  });
});

describe("time masks", () => {
  const base = get("MSE 401").sections[0];
  const at = (partOfTerm: Section["partOfTerm"]): Section => ({
    ...base, partOfTerm,
    meetings: [{ ...base.meetings[0], days: ["M"], start: 600, end: 650 }],
  });
  it("first-half and second-half sections at the same time do not conflict", () => {
    expect(overlaps(sectionMask([at("A")]), sectionMask([at("B")]))).toBe(false);
    expect(overlaps(sectionMask([at("A")]), sectionMask([at("1")]))).toBe(true);
  });
  it("back-to-back classes do not conflict", () => {
    const a = at("1");
    const b: Section = { ...a, meetings: [{ ...a.meetings[0], start: 650, end: 700 }] };
    expect(overlaps(sectionMask([a]), sectionMask([b]))).toBe(false);
  });
});

describe("solver", () => {
  // Nathan's Fall 2026 term from the Grainger planner.
  const cart = ["ECE 205", "MSE 401", "PHYS 214", "MATH 257", "MSE 307", "STAT 400"].map((courseId) => ({ courseId, required: true }));

  it("finds conflict-free schedules for a real MatSE semester", () => {
    const r = solve(cart, catalog, DEFAULT_PROFILE, prefs({ includeClosed: true }), {});
    expect(r.schedules.length).toBeGreaterThan(0);
    for (const s of r.schedules.slice(0, 10)) {
      expect(s.options).toHaveLength(cart.length);
      for (let i = 0; i < s.options.length; i++)
        for (let j = i + 1; j < s.options.length; j++) expect(overlaps(s.options[i].mask, s.options[j].mask)).toBe(false);
    }
  });

  it("respects days off", () => {
    const r = solve(cart.slice(0, 3), catalog, DEFAULT_PROFILE, prefs({ includeClosed: true, daysOff: ["F"] }), {});
    for (const s of r.schedules)
      for (const o of s.options) for (const sec of o.sections) for (const m of sec.meetings) expect(m.days).not.toContain("F");
  });

  it("adds optional courses when they fit", () => {
    const r = solve([...cart.slice(0, 2), { courseId: "ECON 102", required: false }], catalog, DEFAULT_PROFILE, prefs({ includeClosed: true }), {});
    expect(r.schedules[0].options.map((o) => o.courseId)).toContain("ECON 102");
  });

  it("reports courses that can never fit together", () => {
    const r = solve(
      [{ courseId: "MSE 401", required: true }, { courseId: "MSE 401", required: true }],
      catalog, DEFAULT_PROFILE, prefs({ includeClosed: true }), {},
    );
    expect(r.schedules).toHaveLength(0);
    expect(r.clashes).toEqual([["MSE 401", "MSE 401"]]);
  });

  it("re-solves one course while keeping the rest of the schedule", () => {
    const p = prefs({ includeClosed: true });
    const first = solve(cart, catalog, DEFAULT_PROFILE, p, {}).schedules[0];
    const r = findReplacement(first, "STAT 400", cart, catalog, DEFAULT_PROFILE, p, {});
    for (const s of r.schedules)
      for (const o of s.options) {
        if (o.courseId === "STAT 400") continue;
        const before = first.options.find((x) => x.courseId === o.courseId)!;
        expect(o.sections.map((x) => x.crn)).toEqual(before.sections.map((x) => x.crn));
      }
  });
});

describe("gpa", () => {
  it("matches instructor names across sources", () => {
    expect(instructorKey("Holder, G")).toBe(instructorKey("Holder, Gerald W"));
    expect(instructorKey("Gerald Holder")).toBe("holder|g");
  });
  it("parses quoted csv", () => {
    expect(parseCsvLine('2026,Winter,"Hall, Steven R",3')).toEqual(["2026", "Winter", "Hall, Steven R", "3"]);
  });
  it("orders terms within a year", () => {
    expect(termRank("2025-fa")).toBeGreaterThan(termRank("2025-su"));
  });
  it("computes weighted GPA and share of A grades", () => {
    const counts = { "A+": 0, A: 2, "A-": 0, "B+": 0, B: 2, "B-": 0, "C+": 0, C: 0, "C-": 0, "D+": 0, D: 0, "D-": 0, F: 0 };
    const g = aggregateGpa([{ yearTerm: "2025-fa", year: 2025, subject: "MSE", number: "401", title: "Thermo", counts, instructor: "Doe, Jane" }], { sinceYear: 2021 });
    expect(g["MSE 401"].course.gpa).toBe(3.5);
    expect(g["MSE 401"].course.pctA).toBe(50);
    expect(g["MSE 401"].instructors["doe|j"].students).toBe(4);
  });
});
