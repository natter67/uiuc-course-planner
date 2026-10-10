import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAvailability, parseSubjectCascade, toRawCourse } from "../scripts/crawl";
import { normalizeCourse } from "../src/lib/normalize";
import { DEFAULT_PROFILE, evaluateAccess } from "../src/lib/restrictions";

const xmlText = readFileSync("tests/fixtures/mse-2026-fall-cascade.xml", "utf8");
const html = readFileSync("tests/fixtures/mse-406-2026-fall.html", "utf8");

describe("crawler parsing (real Course Explorer responses)", () => {
  it("reads seat status per CRN from the course page", () => {
    expect(parseAvailability(html)).toEqual({ "42990": "Open (Restricted)", "63203": "Closed" });
  });

  const courses = parseSubjectCascade(xmlText).map((c) => normalizeCourse(toRawCourse(c, parseAvailability(html))));
  const mse406 = courses.find((c) => c.id === "MSE 406")!;
  const mse307 = courses.find((c) => c.id === "MSE 307")!;

  it("reads courses, sections, meetings and gen eds", () => {
    expect(courses.map((c) => c.id)).toEqual(["MSE 307", "MSE 406"]);
    expect(mse307.genEd).toEqual(["1CLL"]);
    expect(mse307.minHours).toBe(3);
    const ae1 = mse307.sections.find((s) => s.code === "AE1")!;
    expect(ae1.group).toBe("lecture");
    expect(ae1.meetings).toHaveLength(2);
    expect(ae1.meetings[0]).toMatchObject({ days: ["M", "W"], start: 780, end: 830, instructors: ["TerBush, J"] });
    expect(mse307.sections.find((s) => s.code === "AB1")!.meetings[0].instructors).toEqual(["Alling, T", "Kim, J"]);
  });

  it("joins seat status onto sections", () => {
    expect(mse406.sections.find((s) => s.crn === "42990")!.status).toBe("restricted");
    expect(mse406.sections.find((s) => s.crn === "63203")!.status).toBe("closed");
    expect(mse307.sections[0].status).toBe("unknown");
  });

  it("applies course-level major restrictions to every section", () => {
    for (const s of mse406.sections) expect(s.restrictions.join(" ")).toMatch(/Restricted to Materials Science/);
    expect(evaluateAccess(mse406.sections[0], DEFAULT_PROFILE).access).not.toBe("blocked");
    const physicsMajor = { ...DEFAULT_PROFILE, major: "Physics", majorAliases: [], college: "Liberal Arts & Sciences" };
    expect(evaluateAccess(mse406.sections[0], physicsMajor).access).toBe("blocked");
  });

  it("links MSE 406 lecture A with discussions AD*", () => {
    expect(mse406.linkedByLetter).toBe(true);
  });
});
