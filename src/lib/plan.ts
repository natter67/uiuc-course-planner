// Turns a parsed audit + the course index into (1) candidate courses for every unmet need and
// (2) a semester-by-semester plan to graduation.

import { courseMatches, openNeeds, takenIds, type Audit, type OpenNeed } from "./audit";
import type { IndexRow } from "./data";
import { checkPrereqs, parsePrereqs, type PrereqCheck } from "./prereqs";
import { evaluateAccess, type StudentProfile } from "./restrictions";
import { supplementFor } from "./supplements";
import type { Section } from "./types";

export type Season = "fa" | "sp" | "su";

export interface Candidate {
  row: IndexRow;
  prereq: PrereqCheck;
  /** Taught in the target season in recent years (or offered in the loaded term). */
  offeredInSeason: boolean;
  /** Other open needs this course would also count toward. */
  alsoFills: string[];
  alsoFillsKeys: string[];
  group?: string; // supplement group, e.g. "Introductory"
  /** Restricted to other majors / not intended for the student's college. */
  blocked: string | null;
}

export interface NeedPlan {
  need: OpenNeed;
  /** "specific": a short list of named courses you must take (core). "choose": pick from many. */
  kind: "specific" | "choose" | "gened";
  candidates: Candidate[];
  notes: string[];
  source?: string;
}

export const hoursOf = (row: IndexRow): number => Number(/\d+(?:\.\d+)?/.exec(row.hours)?.[0] ?? 3) || 3;
const levelOf = (id: string): number => Number(id.split(" ")[1] ?? 0);

export function termSeason(term: string): Season {
  if (term.startsWith("SP") || term.endsWith("spring")) return "sp";
  if (term.startsWith("SU") || term.endsWith("summer")) return "su";
  return "fa";
}

/** "FA26" -> next regular term "SP27". */
export function nextTerm(t: string): string {
  const y = Number(t.slice(2));
  const s = t.slice(0, 2);
  if (s === "FA") return `SP${String(y + 1).padStart(2, "0")}`;
  return `FA${String(y).padStart(2, "0")}`;
}

export function termName(t: string): string {
  const names: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };
  return `${names[t.slice(0, 2)] ?? t.slice(0, 2)} 20${t.slice(2)}`;
}

/** Latest term in the audit; planning starts with the term after it. */
export function currentTerm(audit: Audit): string {
  const rank = (t: string) => Number(t.slice(2)) * 10 + ({ SP: 1, SU: 2, FA: 3, WI: 0 } as Record<string, number>)[t.slice(0, 2)];
  return audit.history.map((c) => c.term).sort((a, b) => rank(b) - rank(a))[0] ?? "FA26";
}

function isSpecific(need: OpenNeed): boolean {
  const rules = need.sub?.selectFrom ?? [];
  return rules.length > 0 && rules.length <= 12 && rules.every((r) => r.subject !== "*" && r.from !== null && r.from === r.to);
}

/**
 * @param indexSeason the season of the loaded Course Explorer term; a course offered in that term
 *                    counts as offered in that season even without grade history (new courses).
 */
/** The student's profile plus the minors listed in the audit (for "Restricted to ... minor(s)"). */
export function profileWithAudit(profile: StudentProfile, audit: Audit): StudentProfile {
  const minors = audit.requirements
    .filter((r) => r.kind === "minor")
    .map((r) => r.title.replace(/\(\d+\)/, "").replace(/MINOR/i, "").replace(/&/g, "and").trim())
    .map((t) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
  const major = audit.program ? [audit.program.replace(/&/g, "and"), audit.program] : [];
  return { ...profile, programs: [...new Set([...profile.programs, ...minors])], majorAliases: [...new Set([...profile.majorAliases, ...major])] };
}

export function buildNeedPlans(audit: Audit, index: IndexRow[], targetSeason: Season, indexSeason: Season, profileIn?: StudentProfile): NeedPlan[] {
  const profile = profileIn ? profileWithAudit(profileIn, audit) : undefined;
  const { done, inProgress } = takenIds(audit);
  const needs = openNeeds(audit);
  const byId = new Map(index.map((r) => [r.id, r]));

  const eligible = (row: IndexRow) => levelOf(row.id) < 500 && /^\d{3}$/.test(row.id.split(" ")[1] ?? "");
  const offered = (row: IndexRow) =>
    row.seasons.split(" ").includes(targetSeason) || (row.inTerm && row.sections > 0 && indexSeason === targetSeason);

  const matchesNeed = (need: OpenNeed, row: IndexRow): boolean => {
    if (need.sub?.selectFrom.length) return courseMatches(need.sub, row.id);
    if (need.genEd.length) return row.genEd.some((g) => need.genEd.includes(g));
    const sup = supplementFor(audit.program, need.label);
    return !!sup?.groups.some((g) => g.courses.includes(row.id));
  };

  // Courses named outright by a major/minor need; they can't double as electives for another one.
  const namedRequired = new Set(
    needs
      .filter((n) => n.requirement.kind !== "gened" && n.sub?.selectFrom.length && isSpecific(n))
      .flatMap((n) => n.sub!.selectFrom.map((r) => `${r.subject} ${r.from}`)),
  );

  const plans: NeedPlan[] = needs.map((need) => {
    const sup = supplementFor(audit.program, need.label);
    let rows: { row: IndexRow; group?: string }[] = [];
    if (need.sub?.selectFrom.length) {
      if (isSpecific(need)) {
        rows = need.sub.selectFrom.map((r) => `${r.subject} ${r.from}`).map((id) => ({ row: byId.get(id) ?? stubRow(id) }));
      } else rows = index.filter((r) => eligible(r) && courseMatches(need.sub!, r.id)).map((row) => ({ row }));
    } else if (sup?.groups.length) {
      rows = sup.groups.flatMap((g) => g.courses.map((id) => ({ row: byId.get(id) ?? stubRow(id), group: g.name })));
    } else if (need.genEd.length) {
      rows = index.filter((r) => eligible(r) && r.genEd.some((g) => need.genEd.includes(g))).map((row) => ({ row }));
    }

    // Repeatable lab courses (MSE 404) stay listed even if one section is done.
    const repeatable = (id: string) => need.sub?.selectFrom.length === 1 && need.sub.selectFrom[0].from === levelOf(id);
    const electiveOfMajor = need.requirement.kind !== "gened" && !isSpecific(need);
    const candidates: Candidate[] = rows
      .filter(({ row }) => repeatable(row.id) || (!done.has(row.id) && !inProgress.has(row.id)))
      .filter(({ row }) => !(electiveOfMajor && namedRequired.has(row.id)))
      .map(({ row, group }) => ({
        row,
        group,
        prereq: checkPrereqs(parsePrereqs(row.prereq ? `Prerequisite: ${row.prereq}` : ""), done, inProgress),
        offeredInSeason: offered(row),
        alsoFills: needs.filter((n) => n.key !== need.key && matchesNeed(n, row)).map((n) => n.label),
        alsoFillsKeys: needs.filter((n) => n.key !== need.key && matchesNeed(n, row)).map((n) => n.key),
        blocked: profile ? blockedFor(row, profile) : null,
      }));

    const rank = (c: Candidate) =>
      (c.blocked ? 8 : 0) +
      (c.offeredInSeason ? 0 : 4) +
      (c.prereq.state === "missing" ? 2 : 0) +
      (c.prereq.state === "unknown" && /approval|consent|required courses for/i.test(c.row.prereq) ? 1.5 : 0) +
      (isOddCourse(c.row) ? 3 : 0) +
      (!c.row.hours ? 0.5 : 0) - // not offered in either recent term we have details for
      (c.alsoFills.length ? 1 : 0) -
      (c.row.gpa ?? 2.5) / 10;
    candidates.sort((a, b) => rank(a) - rank(b));

    return {
      need,
      kind: isSpecific(need) ? "specific" : need.source === "gened" ? "gened" : "choose",
      candidates,
      notes: [...(need.sub?.notes ?? []), ...(sup?.notes ?? [])],
      source: sup?.source,
    };
  });
  return plans;
}

/** Research, independent study, variable-credit and similar courses: listed, but never auto-picked. */
export function isOddCourse(row: IndexRow): boolean {
  return (
    /\bTO\b/i.test(row.hours) ||
    /research|independent|individual study|special topics|seminar|thesis|internship|co-?op|undergraduate open|senior project|honors|capstone|senior design|breakthrough projects/i.test(row.title)
  );
}

function stubRow(id: string): IndexRow {
  return { id, title: "", hours: "", genEd: [], sections: 0, open: 0, gpa: null, pctA: null, prereq: "", seasons: "", inTerm: false, restriction: "" };
}

/** Reason a student can't take this course, from its course-wide restriction text. */
export function blockedFor(row: IndexRow, profile: StudentProfile): string | null {
  if (!row.restriction) return null;
  // Class standing changes over the plan (a junior now is a senior in a year), so it never blocks.
  const sentences = row.restriction.split(/(?<=\.)\s+/).filter((r) => !/class standing|students with (Junior|Senior|Sophomore)/i.test(r));
  if (!sentences.length) return null;
  const fake = { restrictions: sentences, status: "open", coRequest: null, specialApproval: null } as unknown as Section;
  const a = evaluateAccess(fake, profile);
  return a.access === "blocked" ? a.reasons.join(" ") : null;
}

// ---- semester roadmap ----

export interface PlannedItem {
  id: string; // course id, or a placeholder like "Technical elective"
  title: string;
  hours: number;
  needLabel: string;
  placeholder: boolean;
  note?: string;
  /** True when the course is only here because a later course needs it. */
  prereqFor?: string;
}

export interface PlannedTerm {
  term: string; // SP27
  items: PlannedItem[];
  hours: number;
}

export interface Roadmap {
  terms: PlannedTerm[];
  unplaced: PlannedItem[]; // couldn't be placed (prereqs never met, never offered)
}

/** Requirement kinds whose courses may also count toward another requirement (gen eds overlap). */
const SHAREABLE = new Set(["gened"]);

/**
 * Greedy roadmap. Each term:
 *   1. required named courses (core) whose prerequisites are met by earlier terms and which are
 *      taught that season — these are the critical path, so they go first;
 *   2. then the remaining needs round-robin, preferring courses that fill several needs at once,
 *      until the term reaches `maxHours`.
 * A course placed for one need also reduces every gen ed need it matches, and satisfying one
 * branch of an "OR" requirement satisfies the requirement.
 */
export function buildRoadmap(
  audit: Audit,
  plansFor: (s: Season) => NeedPlan[],
  opts: { maxHours: number; terms: number },
  index: IndexRow[] = [],
): Roadmap {
  const byId = new Map(index.map((r) => [r.id, r]));
  const { done, inProgress } = takenIds(audit);
  const have = new Set([...done, ...inProgress]);
  const terms: PlannedTerm[] = [];
  let t = nextTerm(currentTerm(audit));

  type Work = {
    key: string; label: string; kind: NeedPlan["kind"]; reqId: string; reqKind: string;
    hours: number; courses: number; groupCounts: Map<string, { n: number; h: number }>;
  };
  const seed = plansFor("sp");
  const work = new Map<string, Work>(
    seed.map((p) => [p.need.key, {
      key: p.need.key, label: p.need.label, kind: p.kind, reqId: p.need.requirement.id, reqKind: p.need.requirement.kind,
      hours: p.need.needs.hours ?? 0, courses: p.need.needs.courses ?? p.need.needs.groups ?? 0, groupCounts: new Map(),
    }]),
  );
  const open = (w: Work) => w.hours > 0 || w.courses > 0;
  const orReqs = new Set(seed.filter((p) => p.need.sub?.number === "OR)").map((p) => p.need.requirement.id));
  const usedIds = new Set<string>();
  const isLab = (w: Work) => /LABORATOR/i.test(w.label);
  const sup = (w: Work) => supplementFor(audit.program, w.label);

  const credit = (w: Work, h: number) => {
    if (w.courses > 0) w.courses -= 1;
    if (w.hours > 0) w.hours = Math.max(0, w.hours - h);
    if (!open(w) && orReqs.has(w.reqId)) for (const o of work.values()) if (o.reqId === w.reqId) { o.hours = 0; o.courses = 0; }
  };

  for (let n = 0; n < opts.terms && [...work.values()].some(open); n++) {
    const season = termSeason(t);
    const plans = new Map(plansFor(season).map((p) => [p.need.key, p]));
    const items: PlannedItem[] = [];
    const here = new Set<string>();
    let hours = 0;

    const fits = (c: Candidate, auto = false) => {
      if (c.blocked) return false;
      if (auto && isOddCourse(c.row)) return false;
      if (c.row.seasons && !c.offeredInSeason) return false;
      if (hours + hoursOf(c.row) > opts.maxHours) return false;
      const pre = checkPrereqs(parsePrereqs(c.row.prereq ? `Prerequisite: ${c.row.prereq}` : ""), have, new Set(), here);
      return pre.state !== "missing";
    };
    const groupOk = (w: Work, c: Candidate) => {
      const g = c.group ? sup(w)?.groups.find((x) => x.name === c.group) : undefined;
      if (!g) return true;
      const used = w.groupCounts.get(g.name) ?? { n: 0, h: 0 };
      return (g.maxCourses === undefined || used.n < g.maxCourses) && (g.maxHours === undefined || used.h + hoursOf(c.row) <= g.maxHours);
    };
    const place = (w: Work, c: Candidate) => {
      const h = hoursOf(c.row);
      items.push({ id: c.row.id, title: c.row.title, hours: h, needLabel: w.label, placeholder: false });
      here.add(c.row.id);
      if (!isLab(w)) usedIds.add(c.row.id);
      hours += h;
      if (c.group) {
        const g = w.groupCounts.get(c.group) ?? { n: 0, h: 0 };
        w.groupCounts.set(c.group, { n: g.n + 1, h: g.h + h });
      }
      credit(w, h);
      // Double counting: gen ed needs are reduced by any course that matches them.
      for (const k of c.alsoFillsKeys) {
        const o = work.get(k);
        if (o && open(o) && (SHAREABLE.has(o.reqKind) || SHAREABLE.has(w.reqKind)) && o.reqId !== w.reqId) credit(o, h);
        else if (o && open(o) && o.reqId === w.reqId && orReqs.has(o.reqId)) credit(o, h);
      }
    };

    // A required course blocked only by one prerequisite we can take now: schedule that prerequisite.
    const placePrereq = (c: Candidate) => {
      const pre = checkPrereqs(parsePrereqs(c.row.prereq ? `Prerequisite: ${c.row.prereq}` : ""), have, new Set(), here);
      if (pre.state !== "missing" || pre.missing.length !== 1) return;
      const options = pre.missing[0].split(" or ").map((id) => byId.get(id)).filter((r): r is IndexRow => !!r);
      for (const r of options) {
        const offered = r.seasons.split(" ").includes(season);
        const own = checkPrereqs(parsePrereqs(r.prereq ? `Prerequisite: ${r.prereq}` : ""), have, new Set(), here);
        const h = hoursOf(r);
        if (!offered || own.state === "missing" || here.has(r.id) || hours + h > opts.maxHours) continue;
        items.push({ id: r.id, title: r.title, hours: h, needLabel: `Prerequisite for ${c.row.id}`, placeholder: false, prereqFor: c.row.id });
        here.add(r.id);
        hours += h;
        return;
      }
    };

    // 1) named required courses (critical path)
    for (const w of work.values()) {
      if (w.kind !== "specific" || !open(w)) continue;
      for (const c of plans.get(w.key)?.candidates ?? []) {
        if (!open(w)) break;
        if (here.has(c.row.id) && !isLab(w)) continue;
        if (!isLab(w) && (usedIds.has(c.row.id) || have.has(c.row.id))) continue;
        if (!fits(c)) { if (!c.blocked && c.offeredInSeason) placePrereq(c); continue; }
        place(w, c);
        if (isLab(w)) {
          // repeatable lab: up to 2 sections a term
          while (open(w) && items.filter((i) => i.needLabel === w.label).length < 2 && hours + hoursOf(c.row) <= opts.maxHours) place(w, c);
          break;
        }
      }
    }
    // 2) everything else, round-robin, best multi-fill candidate first
    let progress = true;
    while (progress && hours < opts.maxHours) {
      progress = false;
      const pending = [...work.values()].filter((w) => w.kind !== "specific" && open(w));
      for (const w of pending) {
        if (!open(w)) continue;
        const pick = (plans.get(w.key)?.candidates ?? [])
          .filter((c) => !usedIds.has(c.row.id) && !here.has(c.row.id) && !have.has(c.row.id) && c.prereq.state !== "unknown" || false)
          .concat((plans.get(w.key)?.candidates ?? []).filter((c) => c.prereq.state === "unknown" && !usedIds.has(c.row.id) && !here.has(c.row.id)))
          // Don't fill an hour requirement with 1-hour courses just because they fit the gap.
          .filter((c) => !(w.hours > 0 && hoursOf(c.row) < Math.min(3, w.hours)))
          .filter((c) => groupOk(w, c) && fits(c, true))
          .sort((a, b) => openFills(b) - openFills(a) || Number(hoursOf(b.row) >= 3) - Number(hoursOf(a.row) >= 3))[0];
        if (pick) { place(w, pick); progress = true; }
      }
    }
    function openFills(c: Candidate) {
      return c.alsoFillsKeys.filter((k) => { const o = work.get(k); return o && open(o) && (SHAREABLE.has(o.reqKind) || orReqs.has(o.reqId)); }).length;
    }

    if (!items.length) break; // nothing more can be placed
    terms.push({ term: t, items, hours: Math.round(hours * 10) / 10 });
    for (const i of items) have.add(i.id);
    t = nextTerm(t);
  }

  const finalPlans = new Map(plansFor("sp").map((p) => [p.need.key, p]));
  const unplaced: PlannedItem[] = [...work.values()].filter(open).map((w) => {
    const left = (finalPlans.get(w.key)?.candidates ?? []).filter((c) => !have.has(c.row.id));
    const why = left.length
      ? left.slice(0, 3).map((c) => `${c.row.id}${c.blocked ? " (restricted)" : c.prereq.missing.length ? ` (needs ${c.prereq.missing.join(", ")})` : !c.row.seasons ? " (no recent offering found)" : ""}`).join("; ")
      : "no eligible course found";
    return { id: w.label, title: "", hours: w.hours, needLabel: w.label, placeholder: true, note: why };
  });
  return { terms, unplaced };
}
