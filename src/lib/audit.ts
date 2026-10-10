// Parses a uAchieve degree audit (the text you get from Cmd+A / Cmd+C on the audit page, or
// document.body.innerText captured by the browser extension) into a requirement tree.
//
// The audit already knows what is left and which courses count ("NEEDS: 6.0 HOURS",
// "SELECT FROM: ABE 200 TO 496 ...", "NOT FROM: 297, 298 ..."), so this works for any
// UIUC major or minor without hand-encoding its rules.

export type ReqStatus = "complete" | "in-progress" | "unfulfilled" | "info";

export interface TakenCourse {
  term: string; // FA25, SP26, SU26
  subject: string; // MATH, or a placeholder like "UBEH" for transfer credit
  number: string; // "241", or "1--" for generic transfer credit
  section: string;
  hours: number;
  grade: string; // A, PS, TR, IP, S
  flags: string[]; // >I in progress, >R repeatable, >- reduced ...
  inProgress: boolean;
  transferNote?: string; // "PARKLAND: PHY 142"
}

/** One rule from a SELECT FROM / NOT FROM list. subject "*" = any subject. */
export interface CourseRule {
  subject: string;
  from: number | null; // null for non-numeric numbers such as "1--"
  to: number | null;
  raw: string; // as written, e.g. "MSE 200 TO 395" or "MSE 396 3 Hour Limit"
  note?: string; // "3 Hour Limit"
}

export interface Needs {
  hours?: number;
  courses?: number;
  groups?: number;
  subgroups?: number;
}

export interface SubRequirement {
  id: string;
  number: string; // "1)", "OR)", ""
  title: string;
  notes: string[];
  status: ReqStatus;
  taken: TakenCourse[];
  needs: Needs;
  selectFrom: CourseRule[];
  notFrom: CourseRule[];
}

export interface Requirement {
  id: string;
  title: string;
  notes: string[];
  status: ReqStatus;
  earnedHours?: number;
  needs: Needs;
  subs: SubRequirement[];
  /** Courses listed directly under the requirement (no sub-requirement). */
  taken: TakenCourse[];
  kind: "major" | "minor" | "gened" | "university" | "summary";
}

export interface Audit {
  program: string; // "Materials Science & Engineering"
  programCode: string; // "0130 BS"
  catalogYear: string; // "202508"
  preparedOn: string;
  requirements: Requirement[];
  /** Every course on record (SUMMARY OF COURSES TAKEN), including in progress. */
  history: TakenCourse[];
  totalHours?: { earned: number; inProgress: number; needed: number; required: number };
}

const STATUS_WORDS: Record<string, ReqStatus> = {
  Complete: "complete",
  "In Progress": "in-progress",
  Unfulfilled: "unfulfilled",
};

function statusOf(word: string | undefined): ReqStatus {
  if (!word) return "info";
  return STATUS_WORDS[word.trim()] ?? "info";
}

const TERM_RE = /^(FA|SP|SU|WI)\d{2}$/;

/** "FA26\tMSE 307 AE1\t3.0\tIP\t>I" */
export function parseCourseLine(line: string): TakenCourse | null {
  const cells = line.split("\t").map((c) => c.trim());
  if (cells.length < 4 || !TERM_RE.test(cells[0])) return null;
  const [term, courseCell, hoursCell, grade, ...rest] = cells;
  const m = /^([A-Z]{2,5})\s+([0-9][0-9A-Z-]*)\s*(.*)$/.exec(courseCell.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const flags = rest.filter((x) => x.startsWith(">"));
  return {
    term,
    subject: m[1],
    number: m[2],
    section: m[3] ?? "",
    hours: Number(hoursCell) || 0,
    grade,
    flags,
    inProgress: grade === "IP" || flags.includes(">I"),
  };
}

/**
 * Parses a SELECT FROM / NOT FROM course list. Handles the uAchieve shorthand:
 *  "MSE 206, 308, 494"          subject carries over to bare numbers
 *  "ABE 200 TO 496"             ranges (also split across lines: "MATH 200\nTO 496")
 *  "ACCY 200 FIN 221 TMGT 365"  several subjects in a row
 *  "***** **--, 297, 298"       any subject, any 1--/2-- placeholder, then 297 in any subject
 *  "MSE 396 3 Hour Limit"       trailing note
 */
export function parseCourseList(text: string): CourseRule[] {
  const tokens = text.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
  const rules: CourseRule[] = [];
  let subject = "*";
  let i = 0;
  const num = (t: string) => (/^\d{3}$/.test(t) ? Number(t) : null);
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === ",") { i++; continue; }
    if (/^\*{3,}$/.test(t)) { subject = "*"; i++; continue; }
    if (/^[A-Z]{2,5}$/.test(t) && t !== "TO") { subject = t; i++; continue; }
    if (t === "TO" && rules.length) {
      const end = num(tokens[i + 1] ?? "");
      const last = rules[rules.length - 1];
      if (end !== null) {
        last.to = end;
        last.raw = `${last.raw} TO ${end}`;
        i += 2;
        continue;
      }
    }
    if (/^[\d*][\d*-]{2}$/.test(t)) {
      const n = num(t);
      const rule: CourseRule = { subject, from: n, to: n, raw: `${subject === "*" ? "any" : subject} ${t}` };
      // trailing note words, e.g. "3 Hour Limit"
      if (/^\d+$/.test(tokens[i + 1] ?? "") && /^hours?$/i.test(tokens[i + 2] ?? "")) {
        const note = [tokens[i + 1], tokens[i + 2], tokens[i + 3] ?? ""].join(" ").trim();
        rule.note = note;
        rule.raw += ` ${note}`;
        i += tokens[i + 3] && /^limit$/i.test(tokens[i + 3]) ? 4 : 3;
      } else i++;
      if (n === null) rule.raw = `${subject === "*" ? "any" : subject} ${t}`;
      rules.push(rule);
      continue;
    }
    i++; // unknown word: skip
  }
  return rules;
}

/** Does course "MSE 404" match a rule? Placeholder rules (null from) match "1--" style numbers. */
export function ruleMatches(rule: CourseRule, subject: string, number: string): boolean {
  if (rule.subject !== "*" && rule.subject !== subject) return false;
  const n = /^\d{3}$/.test(number) ? Number(number) : null;
  if (rule.from === null) return n === null; // "**--" matches non-numeric placeholders
  if (n === null) return false;
  return n >= rule.from && n <= (rule.to ?? rule.from);
}

export function courseMatches(sub: Pick<SubRequirement, "selectFrom" | "notFrom">, courseId: string): boolean {
  const [subject, number] = courseId.split(" ");
  if (sub.notFrom.some((r) => ruleMatches(r, subject, number))) return false;
  return sub.selectFrom.some((r) => ruleMatches(r, subject, number));
}

function parseNeeds(line: string, needs: Needs): boolean {
  // "NEEDS:\t6\tCOURSES" | "NEEDS:\t6.0\tHOURS" | "NEEDS:\t   4SUB-GROUPS" | "NEEDS:\t3.0 HOURS"
  const m = /^NEEDS:\s*([\d.]+)\s*(HOURS?|COURSES?|GROUPS?|SUB-GROUPS?)/i.exec(line.replace(/\t/g, " "));
  if (!m) return false;
  const v = Number(m[1]);
  const unit = m[2].toUpperCase();
  if (unit.startsWith("HOUR")) needs.hours = v;
  else if (unit.startsWith("COURSE")) needs.courses = v;
  else if (unit.startsWith("SUB")) needs.subgroups = v;
  else needs.groups = v;
  return true;
}

function kindOf(title: string): Requirement["kind"] {
  const t = title.toUpperCase();
  if (t.includes("MINOR")) return "minor";
  if (/SUMMARY|LEGEND|GPA|CREDIT COUNTING|JAMES SCHOLAR/.test(t)) return "summary";
  if (/GENERAL EDUCATION|CULTURAL STUDIES|COMPOSITION|FOREIGN LANGUAGE/.test(t)) return "gened";
  if (/RESIDENCY|MINIMUM OF \d+ HOURS/.test(t)) return "university";
  return "major";
}

function cleanTitle(t: string): string {
  return t.replace(/^~+/, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export function parseAudit(text: string): Audit {
  const lines = text.replace(/\r/g, "").split("\n");
  const audit: Audit = { program: "", programCode: "", catalogYear: "", preparedOn: "", requirements: [], history: [] };

  // Header facts
  for (const [i, l] of lines.entries()) {
    if (l.startsWith("Prepared On")) {
      const cells = l.split("\t");
      audit.preparedOn = cells[1] ?? "";
      audit.programCode = cells[3] ?? "";
      audit.catalogYear = cells[5] ?? "";
      // program name is the line before the name/ID block: "<Last, First>\n<Program>\nPrepared On"
      audit.program = (lines[i - 1] ?? "").trim();
      break;
    }
  }

  let req: Requirement | null = null;
  let sub: SubRequirement | null = null;
  let listMode: "select" | "not" | null = null;
  let listBuf = "";
  let lastCourse: TakenCourse | null = null;
  let inHistory = false;
  let reqN = 0;

  const flushList = () => {
    if (!listMode || !listBuf.trim()) { listMode = null; listBuf = ""; return; }
    const rules = parseCourseList(listBuf);
    const target = sub ?? null;
    if (target) (listMode === "select" ? target.selectFrom : target.notFrom).push(...rules);
    listMode = null;
    listBuf = "";
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const flat = line.replace(/\t/g, " ").trim();

    // New requirement: "Requirement: TITLE\tRequirement Unfulfilled\tTITLE"
    const rm = /^Requirement:\s*(.*?)\tRequirement(?: (Complete|In Progress|Unfulfilled))?\t/.exec(line);
    if (rm) {
      flushList();
      const title = cleanTitle(rm[1]);
      if (/^\*+ LEGEND/.test(title)) { req = null; sub = null; inHistory = false; continue; }
      req = { id: `r${reqN++}`, title, notes: [], status: statusOf(rm[2]), needs: {}, subs: [], taken: [], kind: kindOf(title) };
      audit.requirements.push(req);
      sub = null;
      inHistory = /SUMMARY OF COURSES TAKEN/i.test(title);
      lastCourse = null;
      continue;
    }
    if (!req) continue;

    // New sub-requirement: "  Sub-Requirement Unfulfilled 6)\tTITLE"
    const sm = /^\s*Sub-Requirement(?: (Complete|In Progress|Unfulfilled))?\s*([0-9A-Z]*\))?\s*(?:\t(.*))?$/.exec(line);
    if (sm) {
      flushList();
      sub = {
        id: `${req.id}.${req.subs.length}`,
        number: sm[2] ?? "",
        title: cleanTitle(sm[3] ?? ""),
        notes: [],
        status: statusOf(sm[1]),
        taken: [],
        needs: {},
        selectFrom: [],
        notFrom: [],
      };
      req.subs.push(sub);
      if (inHistory && /NOT COUNTING/i.test(sub.title)) inHistory = false;
      lastCourse = null;
      continue;
    }

    const course = parseCourseLine(line);
    if (course) {
      flushList();
      (sub ?? req).taken.push(course);
      if (inHistory) audit.history.push(course);
      lastCourse = course;
      continue;
    }
    // Transfer note under a course: "PARKLAND: PHY 142"
    if (lastCourse && /^[A-Z][A-Z .&'-]+:\s+\S/.test(flat) && !/^(NEEDS|EARNED|SELECT FROM|NOTE|IN-PROGRESS)/.test(flat)) {
      lastCourse.transferNote = flat;
      continue;
    }

    if (/^SELECT FROM:/.test(flat)) { flushList(); listMode = "select"; listBuf = flat.replace(/^SELECT FROM:/, ""); continue; }
    if (/^-- NOT FROM:/.test(flat)) { flushList(); listMode = "not"; listBuf = flat.replace(/^-- NOT FROM:/, ""); continue; }
    if (listMode) {
      // Course lists continue until a line that isn't part of a list.
      if (/^(NEEDS|EARNED|Requirement|Sub-Requirement)/.test(flat) || flat === "") flushList();
      else { listBuf += " " + flat; continue; }
    }

    const target = sub ?? req;
    if (parseNeeds(flat, target.needs)) continue;
    const em = /^EARNED:\s*([\d.]+)\s*HOURS/.exec(flat);
    if (em) { if (!sub) req.earnedHours = Number(em[1]); continue; }
    if (/^IN-PROGRESS\s+([\d.]+)\s*HOURS/.test(flat) && /128|MINIMUM/.test(req.title)) {
      const ip = Number(/([\d.]+)/.exec(flat)![1]);
      audit.totalHours = { earned: req.earnedHours ?? 0, inProgress: ip, needed: 0, required: Number(/(\d+) HOURS/.exec(req.title)?.[1] ?? 0) };
      continue;
    }
    if (flat && !/^\(?\s*[\d.]+\s*HOURS (TAKEN|ADDED)\)?$/.test(flat) && !/^\d+\s+COURSES? TAKEN$/.test(flat) && !/GPA HOURS EARNED/.test(flat) && flat !== "Sub-Requirement") {
      target.notes.push(flat);
    }
  }
  flushList();

  const total = audit.requirements.find((r) => /MINIMUM OF \d+ HOURS/.test(r.title));
  if (total && audit.totalHours) audit.totalHours.needed = total.needs.hours ?? 0;

  // Sub-requirement titles sometimes wrap onto the following note lines; keep the first line as title.
  return audit;
}

// ---- interpretation helpers ----

export function courseId(c: Pick<TakenCourse, "subject" | "number">): string {
  return `${c.subject} ${c.number}`;
}

/** Courses the student has credit for or is taking (real course numbers only). */
export function takenIds(audit: Audit): { done: Set<string>; inProgress: Set<string> } {
  const done = new Set<string>();
  const inProgress = new Set<string>();
  const all = audit.history.length ? audit.history : audit.requirements.flatMap((r) => [...r.taken, ...r.subs.flatMap((s) => s.taken)]);
  for (const c of all) {
    if (!/^\d{3}$/.test(c.number)) continue;
    (c.inProgress ? inProgress : done).add(courseId(c));
  }
  return { done, inProgress };
}

/** Gen ed categories implied by a sub-requirement title, as Course Explorer gen ed codes. */
export function genEdCodesFor(title: string): string[] {
  const t = title.toUpperCase();
  if (t.includes("NON-WESTERN")) return ["1NW"];
  if (t.includes("MINORITY")) return ["1US"];
  if (t.includes("WESTERN")) return ["1WCC"];
  if (t.includes("HUMANITIES")) return ["1HP", "1LA"];
  if (t.includes("SOCIAL") || t.includes("BEHAVIORAL")) return ["1SS", "1BSC"];
  if (t.includes("NATURAL SCIENCE")) return ["1LS", "1PS"];
  if (t.includes("QUANTITATIVE")) return ["1QR1", "1QR2"];
  if (t.includes("ADVANCED COMPOSITION")) return ["1CLL"];
  if (t.includes("COMPOSITION I")) return ["1FC1"];
  return [];
}

export interface OpenNeed {
  key: string; // stable id for UI state
  requirement: Requirement;
  sub: SubRequirement | null;
  label: string;
  needs: Needs;
  /** How courses are chosen for this need. */
  source: "list" | "gened" | "none";
  genEd: string[];
}

/** Every unmet piece of the audit that a course could fill, in audit order. */
export function openNeeds(audit: Audit): OpenNeed[] {
  const out: OpenNeed[] = [];
  for (const r of audit.requirements) {
    if (r.kind === "summary" || r.kind === "university") continue;
    if (r.status === "complete") continue;
    const subs = r.subs.filter((s) => s.status === "unfulfilled" || (s.status !== "complete" && (s.needs.hours || s.needs.courses)));
    for (const s of subs) {
      if (!s.needs.hours && !s.needs.courses && !s.needs.groups && !s.selectFrom.length) continue;
      const genEd = [...genEdCodesFor(s.title), ...(r.kind === "gened" && !s.title ? genEdCodesFor(r.title) : [])];
      const fromTitle = genEdCodesFor(r.title);
      const codes = genEd.length ? genEd : r.kind === "gened" ? fromTitle : [];
      out.push({
        key: s.id,
        requirement: r,
        sub: s,
        label: s.title || r.title,
        needs: s.needs,
        source: s.selectFrom.length ? "list" : codes.length ? "gened" : "none",
        genEd: codes,
      });
    }
    if (!r.subs.length && (r.needs.hours || r.needs.courses)) {
      const codes = genEdCodesFor(r.title);
      out.push({ key: r.id, requirement: r, sub: null, label: r.title, needs: r.needs, source: codes.length ? "gened" : "none", genEd: codes });
    }
  }
  return out;
}

/** "6 hours", "2 courses" */
export function needsText(n: Needs): string {
  const parts: string[] = [];
  if (n.courses) parts.push(`${n.courses} course${n.courses === 1 ? "" : "s"}`);
  if (n.hours) parts.push(`${n.hours} hour${n.hours === 1 ? "" : "s"}`);
  if (n.groups) parts.push(`${n.groups} group${n.groups === 1 ? "" : "s"}`);
  if (n.subgroups) parts.push(`${n.subgroups} sub-group${n.subgroups === 1 ? "" : "s"}`);
  return parts.join(", ");
}
