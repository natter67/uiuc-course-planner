import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courseMatches, openNeeds, parseAudit, parseCourseLine, parseCourseList, takenIds } from "../src/lib/audit";
import type { IndexRow } from "../src/lib/data";
import { blockedFor, buildNeedPlans, buildRoadmap, nextTerm, profileWithAudit } from "../src/lib/plan";
import { checkPrereqs, parsePrereqs } from "../src/lib/prereqs";
import { DEFAULT_PROFILE } from "../src/lib/restrictions";

// A real MatSE audit with the student's name, ID and grades removed.
const audit = parseAudit(readFileSync("tests/fixtures/uachieve-matse-audit.txt", "utf8"));

describe("audit parsing", () => {
  it("reads the header", () => {
    expect(audit.program).toBe("Materials Science & Engineering");
    expect(audit.programCode).toBe("0130 BS");
    expect(audit.catalogYear).toBe("202508");
    expect(audit.totalHours).toEqual({ earned: 99, inProgress: 18, needed: 29, required: 128 });
  });

  it("reads course lines, including in-progress and transfer credit", () => {
    expect(parseCourseLine("FA26\tMSE 307 AE1\t3.0\tIP\t>I\t")).toMatchObject({ term: "FA26", subject: "MSE", number: "307", hours: 3, inProgress: true });
    expect(parseCourseLine("SP22\tUBEH 1-- 002\t3.0\tTR\t\t")).toMatchObject({ subject: "UBEH", number: "1--", grade: "TR" });
    const phys212 = audit.history.find((c) => c.subject === "PHYS" && c.number === "212")!;
    expect(phys212.transferNote).toBe("PARKLAND: PHY 142");
  });

  it("knows what is done and what is in progress", () => {
    const { done, inProgress } = takenIds(audit);
    expect(done.has("MSE 201")).toBe(true);
    expect(done.has("PHYS 212")).toBe(true);
    expect([...inProgress].sort()).toEqual(["ECE 205", "MATH 257", "MSE 307", "MSE 401", "PHYS 214", "STAT 400"]);
  });

  it("reads requirement status and needs", () => {
    const core = audit.requirements.find((r) => r.title === "REQUIRED COURSES")!;
    expect(core.status).toBe("unfulfilled");
    const tech = core.subs.find((s) => s.title.startsWith("MATERIALS SCIENCE & ENGINEERING TECHNICAL CORE"))!;
    expect(tech.needs).toEqual({ courses: 6 });
    expect(tech.selectFrom.map((r) => r.raw)).toEqual(["MSE 206", "MSE 308", "MSE 494", "MSE 495", "MSE 402", "MSE 406"]);
    expect(audit.requirements.find((r) => r.title.startsWith("COMPOSITION I"))!.status).toBe("complete");
  });

  it("finds the minor", () => {
    const minor = audit.requirements.find((r) => r.kind === "minor")!;
    expect(minor.title).toBe("TECHNOLOGY & MANAGEMENT MINOR (4033)");
    expect(minor.subs[1].selectFrom.map((r) => r.raw)).toEqual(["TMGT 366", "TMGT 367", "TMGT 460", "TMGT 461"]);
  });

  it("lists every open need", () => {
    const labels = openNeeds(audit).map((n) => n.label);
    expect(labels).toContain("TECHNICAL ELECTIVES");
    expect(labels).toContain("TOPICAL LECTURES");
    expect(labels).toContain("NON-WESTERN CULTURES");
    expect(labels).not.toContain("ORIENTATION AND PROFESSIONAL DEVELOPMENT");
  });
});

describe("course lists", () => {
  it("expands uAchieve shorthand", () => {
    expect(parseCourseList("MSE 206, 308, 494").map((r) => r.raw)).toEqual(["MSE 206", "MSE 308", "MSE 494"]);
    expect(parseCourseList("ACCY 200 FIN 221 TMGT 365").map((r) => r.raw)).toEqual(["ACCY 200", "FIN 221", "TMGT 365"]);
    expect(parseCourseList("MATH 200 TO 496 MCB 200 TO 496").map((r) => [r.subject, r.from, r.to])).toEqual([["MATH", 200, 496], ["MCB", 200, 496]]);
    expect(parseCourseList("MSE 200 TO 395, 396 3 Hour Limit,")[1]).toMatchObject({ subject: "MSE", from: 396, note: "3 Hour Limit" });
  });

  it("applies the tech elective rule exactly as the audit states it", () => {
    const tech = openNeeds(audit).find((n) => n.label === "TECHNICAL ELECTIVES")!.sub!;
    expect(courseMatches(tech, "ECE 340")).toBe(true);
    expect(courseMatches(tech, "MSE 456")).toBe(true);
    expect(courseMatches(tech, "CS 498")).toBe(false); // special topics, NOT FROM
    expect(courseMatches(tech, "MSE 494")).toBe(false); // NOT FROM
    expect(courseMatches(tech, "ECON 302")).toBe(false); // subject not listed
    expect(courseMatches(tech, "MATH 199")).toBe(false); // below 200
  });
});

describe("prerequisites", () => {
  const done = new Set(["MATH 241", "PHYS 211", "CS 101", "MSE 201", "MATH 285", "ECE 205"]);
  const ip = new Set(["MATH 257", "MSE 401", "MSE 307", "PHYS 214"]);
  const check = (t: string, planned: string[] = []) => checkPrereqs(parsePrereqs(`Prerequisite: ${t}`), done, ip, new Set(planned));

  it("handles AND, OR, parentheses and sentences", () => {
    expect(check("MATH 241 and PHYS 211. Credit or concurrent enrollment in CS 101 or CS 124; and MATH 225 or 257 or MATH 415; and MSE 201.").state).toBe("met");
    expect(check("(ECE 205 or ECE 210) and PHYS 214.").state).toBe("met");
    expect(check("One of MATH 225, MATH 257, or MATH 415; PHYS 214.").state).toBe("met");
  });

  it("reports what's missing", () => {
    expect(check("MSE 206; credit or concurrent registration in MSE 201 and MSE 401.")).toEqual({ state: "missing", missing: ["MSE 206"] });
    expect(check("Completion of ECON 102 or ECON 103.")).toEqual({ state: "missing", missing: ["ECON 102 or ECON 103"] });
  });

  it("accepts concurrent registration only when the course is planned the same term", () => {
    expect(check("Credit or concurrent registration in MSE 307 and MSE 406.").state).toBe("missing");
    expect(check("Credit or concurrent registration in MSE 307 and MSE 406.", ["MSE 406"]).state).toBe("met-if-concurrent");
  });

  it("treats class standing as satisfied", () => {
    expect(check("Sophomore standing.").state).toBe("met");
  });
});

describe("planning", () => {
  // A small course index shaped like public/data/<term>/index.json.
  const row = (id: string, o: Partial<IndexRow> = {}): IndexRow => ({
    id, title: id, hours: "3 hours", genEd: [], sections: 1, open: 1, gpa: 3.2, pctA: 50, prereq: "", seasons: "fa sp", inTerm: true, restriction: "", ...o,
  });
  const index: IndexRow[] = [
    row("MSE 206", { hours: "4 hours", seasons: "sp", prereq: "MATH 241 and PHYS 211." }),
    row("MSE 402", { seasons: "sp", prereq: "MSE 201 and MSE 401." }),
    row("MSE 406", { seasons: "fa", prereq: "MSE 206; credit or concurrent registration in MSE 201 and MSE 401." }),
    row("MSE 308", { seasons: "sp", genEd: ["1CLL"], prereq: "Credit or concurrent registration in MSE 307 and MSE 406." }),
    row("MSE 494", { hours: "1 hours", seasons: "fa", prereq: "MSE 308.", restriction: "Restricted to students with Senior class standing." }),
    row("MSE 495", { hours: "2 hours", seasons: "sp", prereq: "Credit in MSE 494." }),
    row("MSE 304", { seasons: "sp", prereq: "PHYS 214." }),
    row("MSE 405", { seasons: "sp", prereq: "MSE 201, MATH 285 and PHYS 214." }),
    row("MSE 404", { hours: "1.5 hours", prereq: "MSE 307 and MSE 308 or permission of instructor. Senior standing." }),
    row("MSE 440", { prereq: "MSE 406." }),
    row("MSE 450"),
    row("MSE 420"),
    row("MSE 485", { seasons: "sp" }),
    row("ECE 340", { prereq: "(ECE 205 or ECE 210) and PHYS 214." }),
    row("ME 330", { restriction: "Restricted to Mechanical Engineering major(s)." }),
    row("CS 357"),
    row("REL 208", { genEd: ["1NW", "1LA"], gpa: 3.95 }),
    row("CLCV 224", { genEd: ["1LA", "1US"], gpa: 3.75 }),
    row("ACCY 200"),
    row("FIN 221", { prereq: "Completion of ECON 102 or ECON 103." }),
    row("ECON 102", { genEd: ["1SS"] }),
    row("TMGT 365"), row("TMGT 366", { seasons: "sp" }), row("TMGT 367", { seasons: "fa" }),
    row("TMGT 460", { seasons: "fa", restriction: "Restricted to Technology and Management major(s) or minor(s)." }),
    row("TMGT 461", { seasons: "sp" }),
  ];
  const plansFor = (s: "fa" | "sp" | "su") => buildNeedPlans(audit, index, s, "fa", DEFAULT_PROFILE);

  it("lists core courses with prerequisite status", () => {
    const core = plansFor("sp").find((p) => p.need.label.includes("TECHNICAL CORE"))!;
    const mse206 = core.candidates.find((c) => c.row.id === "MSE 206")!;
    expect(mse206.prereq.state).toBe("met");
    expect(core.candidates.find((c) => c.row.id === "MSE 406")!.prereq.missing).toEqual(["MSE 206"]);
  });

  it("uses the catalog list for topical lectures and flags double-counting", () => {
    const topical = plansFor("fa").find((p) => p.need.label === "TOPICAL LECTURES")!;
    expect(topical.candidates.map((c) => c.row.id)).toEqual(expect.arrayContaining(["MSE 440", "MSE 450", "ECE 340"]));
    expect(topical.candidates.find((c) => c.row.id === "MSE 450")!.group).toBe("Introductory");
    const nw = plansFor("fa").find((p) => p.need.label === "NON-WESTERN CULTURES")!;
    expect(nw.candidates[0].row.id).toBe("REL 208");
    expect(nw.candidates[0].alsoFills).toContain("HUMANITIES & THE ARTS");
  });

  it("blocks other majors' courses but not future standing or the student's own minor", () => {
    const p = profileWithAudit(DEFAULT_PROFILE, audit);
    expect(blockedFor(index.find((r) => r.id === "ME 330")!, p)).toMatch(/Mechanical/);
    expect(blockedFor(index.find((r) => r.id === "MSE 494")!, p)).toBeNull();
    expect(blockedFor(index.find((r) => r.id === "TMGT 460")!, p)).toBeNull();
  });

  it("builds a semester plan that respects prerequisites and seasons", () => {
    const rm = buildRoadmap(audit, plansFor, { maxHours: 18, terms: 8 }, index);
    const termOf = (id: string) => rm.terms.find((t) => t.items.some((i) => i.id === id))?.term;
    expect(rm.terms[0].term).toBe("SP27");
    expect(termOf("MSE 206")).toBe("SP27");
    expect(termOf("MSE 406")).toBe("FA27"); // fall only, after MSE 206
    expect(termOf("MSE 308")).toBe("SP28"); // spring only, after MSE 406
    expect(termOf("MSE 494")).toBe("FA28");
    expect(termOf("MSE 495")).toBe("SP29");
    // ECON 102 is scheduled before FIN 221 because FIN 221 needs it
    const econ = rm.terms.findIndex((t) => t.items.some((i) => i.id === "ECON 102"));
    const fin = rm.terms.findIndex((t) => t.items.some((i) => i.id === "FIN 221"));
    expect(econ).toBeGreaterThanOrEqual(0);
    expect(fin).toBeGreaterThan(econ);
    // MSE 404: four 1.5-hour sections
    expect(rm.terms.flatMap((t) => t.items).filter((i) => i.id === "MSE 404")).toHaveLength(4);
    // no other major's restricted course
    expect(termOf("ME 330")).toBeUndefined();
    for (const t of rm.terms) expect(t.hours).toBeLessThanOrEqual(18);
  });

  it("orders terms", () => {
    expect(nextTerm("FA26")).toBe("SP27");
    expect(nextTerm("SP27")).toBe("FA27");
  });
});
