// Reads the "Prerequisite:" sentence Course Explorer publishes for each course and checks it
// against what a student has done. The text is free-form English, so this is a best effort:
// anything it can't parse comes back as "unknown" and the UI shows the original sentence.
//
//   "Prerequisite: MSE 206; credit or concurrent registration in MSE 201 and MSE 401."
//   "Prerequisite: One of MATH 225, MATH 257, or MATH 415; PHYS 214."
//   "Prerequisite: CS 225 or ECE 220."

export interface PrereqClause {
  anyOf: string[]; // satisfied by any one course
  concurrentOk: boolean; // "credit or concurrent registration in ..."
  text: string;
}

export interface Prereqs {
  text: string; // the original sentence, "" when the course lists none
  clauses: PrereqClause[];
  /** Parts we couldn't turn into course rules (consent of instructor, class standing ...). */
  other: string[];
}

const COURSE_RE = /\b([A-Z]{2,5})\s?(\d{3})\b/g;

export function extractPrereqText(info: string): string {
  const m = /Prerequisites?:\s*(.*?)(?:(?<=\.)\s+(?:Credit is not|Restricted|Approved|Same as|May be repeated|\d+ (?:under)?graduate hours)|$)/is.exec(info);
  return m ? m[1].trim() : "";
}

function coursesIn(s: string): string[] {
  const out: string[] = [];
  let lastSubject = "";
  // Expand "MATH 225, 257, or 415" style lists where the subject is written once.
  const tokens = s.replace(/,/g, " , ").split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[.;()]/g, "");
    if (/^[A-Z]{2,5}$/.test(t) && /^\d{3}/.test(tokens[i + 1] ?? "")) {
      lastSubject = t;
      out.push(`${t} ${tokens[i + 1].slice(0, 3)}`);
      i++;
    } else if (/^\d{3}$/.test(t) && lastSubject) {
      out.push(`${lastSubject} ${t}`);
    }
  }
  return [...new Set(out)];
}

/** Splits on " and " / ", and" that sit outside parentheses. */
function splitTopLevelAnd(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0) {
      const m = /^,?\s+and\s+/i.exec(s.slice(i));
      if (m && cur.trim()) {
        parts.push(cur);
        cur = "";
        i += m[0].length - 1;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Turns a prerequisite sentence into AND-ed clauses, each an OR over courses:
 *   "MSE 206; credit or concurrent registration in MSE 201 and MSE 401"
 *     -> [MSE 206] AND [MSE 201 (concurrent ok)] AND [MSE 401 (concurrent ok)]
 *   "(ECE 205 or ECE 210) and PHYS 214" -> [ECE 205 | ECE 210] AND [PHYS 214]
 *   "One of MATH 225, MATH 257, or MATH 415" -> [MATH 225 | MATH 257 | MATH 415]
 */
export function parsePrereqs(info: string): Prereqs {
  const text = extractPrereqText(info);
  const clauses: PrereqClause[] = [];
  const other: string[] = [];
  if (!text) return { text, clauses, other };

  for (const sentence of text.split(/;|\.\s+(?=[A-Z(])/)) {
    const part = sentence.trim().replace(/\.$/, "").replace(/^and\s+/i, "");
    if (!part) continue;
    const concurrentOk = /concurrent/i.test(part);
    for (const pieceRaw of splitTopLevelAnd(part)) {
      const piece = pieceRaw.trim().replace(/^[(]|[)]$/g, "");
      const courses = coursesIn(piece);
      const words = piece.replace(/credit or concurrent (registration|enrollment) in/gi, "").replace(COURSE_RE, "").replace(/[\s,().]|\bor\b|\bone of\b|\band\b/gi, "");
      if (!courses.length) { other.push(piece); continue; }
      if (/[a-z]{4,}/i.test(words) && /\bor\b/i.test(piece)) {
        // "MSE 308 or permission of instructor": the course is one way to qualify; flag the rest.
        other.push(piece);
      }
      clauses.push({ anyOf: courses, concurrentOk: concurrentOk || /concurrent/i.test(piece), text: piece });
    }
  }
  return { text, clauses, other };
}

export type PrereqState = "met" | "met-if-concurrent" | "missing" | "none" | "unknown";

export interface PrereqCheck {
  state: PrereqState;
  missing: string[]; // one entry per unmet clause, e.g. "MSE 206" or "MATH 225 or MATH 257"
}

/**
 * @param done        courses completed (with credit, incl. transfer/proficiency)
 * @param inProgress  courses being taken now; they count as done by next term
 * @param planned     courses planned for the same term as this course (for concurrent rules)
 */
export function checkPrereqs(p: Prereqs, done: Set<string>, inProgress: Set<string>, planned: Set<string> = new Set()): PrereqCheck {
  if (!p.text) return { state: "none", missing: [] };
  if (!p.clauses.length) return { state: p.other.every((o) => /standing/i.test(o)) ? "met" : "unknown", missing: [] };
  const missing: string[] = [];
  let needsConcurrent = false;
  for (const c of p.clauses) {
    const has = c.anyOf.some((x) => done.has(x) || inProgress.has(x));
    if (has) continue;
    if (c.concurrentOk && c.anyOf.some((x) => planned.has(x))) { needsConcurrent = true; continue; }
    missing.push(c.anyOf.join(" or "));
  }
  if (missing.length) return { state: "missing", missing };
  if (needsConcurrent) return { state: "met-if-concurrent", missing: [] };
  // Class standing is assumed fine for students planning ahead; other notes (consent, approval) stay "unknown".
  const realOther = p.other.filter((o) => !/standing/i.test(o) && !/^[A-Z]{2,5} \d{3} or (permission|consent)/i.test(o));
  return { state: realOther.length ? "unknown" : "met", missing: [] };
}
