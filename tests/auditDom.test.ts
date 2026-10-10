// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openNeeds, parseAudit, takenIds } from "../src/lib/audit";
import { serializeAuditHtml } from "../src/lib/auditDom";
import { decodeAudit, encodeAudit } from "../src/lib/auditImport";

// The same real audit, saved as a web page (name, ID, grades and GPA removed).
const html = readFileSync("tests/fixtures/uachieve-matse-audit.html", "utf8");
const fromText = parseAudit(readFileSync("tests/fixtures/uachieve-matse-audit.txt", "utf8"));

describe("reading the audit page's HTML", () => {
  const text = serializeAuditHtml(html);
  const fromHtml = parseAudit(text);

  it("doesn't copy the student's name or ID", () => {
    expect(text).not.toMatch(/Student, Example|000000000/);
  });

  it("matches the copy-and-paste import", () => {
    expect(fromHtml.program).toBe(fromText.program);
    expect(fromHtml.catalogYear).toBe(fromText.catalogYear);
    expect(fromHtml.requirements.map((r) => [r.title, r.status])).toEqual(fromText.requirements.map((r) => [r.title, r.status]));
    const subs = (a: typeof fromText) => a.requirements.flatMap((r) => r.subs.map((s) => [s.number, s.title, s.status, JSON.stringify(s.needs), s.selectFrom.map((x) => x.raw).join("|"), s.notFrom.length, s.taken.length]));
    expect(subs(fromHtml)).toEqual(subs(fromText));
    expect([...takenIds(fromHtml).done].sort()).toEqual([...takenIds(fromText).done].sort());
    expect(openNeeds(fromHtml).map((n) => n.label)).toEqual(openNeeds(fromText).map((n) => n.label));
  });
});

describe("link hand-off from the extension", () => {
  it("round-trips the audit through the URL fragment", async () => {
    const text = readFileSync("tests/fixtures/uachieve-matse-audit.txt", "utf8");
    const encoded = await encodeAudit(text);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThan(text.length / 2);
    expect(await decodeAudit(encoded)).toBe(text);
  });
});
