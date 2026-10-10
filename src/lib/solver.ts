// Schedule solver: picks one section per component (lecture / discussion / lab ...) for
// every course in the cart, respecting linked sections, restrictions, seat status,
// 8-week halves and the student's time preferences, and ranks the conflict-free results.

import { sectionGpa } from "./gpa";
import { evaluateAccess, type AccessResult, type StudentProfile } from "./restrictions";
import type { Course, Day, GpaIndex, Section } from "./types";
import { DAYS } from "./types";

export interface CartItem {
  courseId: string;
  required: boolean;
}

export interface BusyBlock {
  label: string;
  days: Day[];
  start: number; // minutes after midnight
  end: number;
}

export interface Preferences {
  earliestStart: number | null; // no class may start before this
  latestEnd: number | null; // no class may end after this
  daysOff: Day[];
  busy: BusyBlock[];
  includeClosed: boolean; // plan with closed sections too (e.g. hoping for a seat)
  includeBlocked: boolean; // ignore restriction guesses
  avoidOnline: boolean; // skip online / arranged sections
  maxHours: number | null;
  /** Section CRNs that must be used (per course). */
  pinned: Record<string, string[]>;
  /** Section CRNs that must not be used. */
  excluded: string[];
  weights: { gpa: number; gaps: number; fewerDays: number; lateStart: number };
  maxResults: number;
}

export const DEFAULT_PREFS: Preferences = {
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  busy: [],
  includeClosed: false,
  includeBlocked: false,
  avoidOnline: false,
  maxHours: null,
  pinned: {},
  excluded: [],
  weights: { gpa: 1, gaps: 1, fewerDays: 1, lateStart: 0.5 },
  maxResults: 50,
};

/** One way to take a course: a set of sections, one per component. */
export interface CourseOption {
  courseId: string;
  sections: Section[];
  mask: Uint32Array;
  /** Other options with exactly the same meeting times (e.g. same time, different TA). */
  sameTime: CourseOption[];
  gpaDelta: number | null; // instructor GPA minus course GPA
  instructorGpa: number | null;
  instructorName: string | null;
  penalty: number; // restricted / closed / pending sections
  access: AccessResult[];
}

export interface Schedule {
  options: CourseOption[];
  score: number;
  hours: number;
  metrics: { daysOnCampus: number; gapHours: number; earliest: number | null; latest: number | null; avgGpaDelta: number | null };
  missingOptional: string[];
}

export interface CourseDiagnosis {
  courseId: string;
  options: number;
  reason: string | null; // why no options are available
}

export interface SolveResult {
  schedules: Schedule[];
  diagnoses: CourseDiagnosis[];
  /** Pairs of required courses that can never fit together with the current filters. */
  clashes: [string, string][];
  searched: number;
  truncated: boolean;
}

// ---- time masks: 5-minute slots from 7:00 to 23:00, five days, two half-terms ----
const SLOT = 5;
const DAY_START = 7 * 60;
const SLOTS_PER_DAY = ((23 - 7) * 60) / SLOT; // 192
const WORDS_PER_DAY = SLOTS_PER_DAY / 32; // 6
const WORDS_PER_HALF = WORDS_PER_DAY * 5; // 30
const MASK_WORDS = WORDS_PER_HALF * 2; // first-half + second-half

function setRange(mask: Uint32Array, half: 0 | 1, day: number, start: number, end: number) {
  const a = Math.max(0, Math.floor((start - DAY_START) / SLOT));
  const b = Math.min(SLOTS_PER_DAY, Math.ceil((end - DAY_START) / SLOT));
  for (let s = a; s < b; s++) {
    const w = half * WORDS_PER_HALF + day * WORDS_PER_DAY + (s >> 5);
    mask[w] |= 1 << (s & 31);
  }
}

export function sectionMask(sections: Section[]): Uint32Array {
  const mask = new Uint32Array(MASK_WORDS);
  for (const s of sections) {
    const halves: (0 | 1)[] = s.partOfTerm === "A" ? [0] : s.partOfTerm === "B" ? [1] : [0, 1];
    for (const m of s.meetings) {
      if (m.start === null || m.end === null) continue;
      for (const d of m.days) for (const h of halves) setRange(mask, h, DAYS.indexOf(d), m.start, m.end);
    }
  }
  return mask;
}

export function overlaps(a: Uint32Array, b: Uint32Array): boolean {
  for (let i = 0; i < MASK_WORDS; i++) if (a[i] & b[i]) return true;
  return false;
}

// ---- building options per course ----

function timedMeetings(s: Section) {
  return s.meetings.filter((m) => m.start !== null && m.end !== null && m.days.length);
}

/** Reason a section fails the hard filters, or null when it passes. */
function sectionFilter(s: Section, access: AccessResult, prefs: Preferences): string | null {
  if (prefs.excluded.includes(s.crn)) return "excluded";
  if (s.status === "closed" && !prefs.includeClosed) return "closed";
  if (access.access === "blocked" && !prefs.includeBlocked) return "restricted";
  if (prefs.avoidOnline && s.meetings.some((m) => m.start === null || /online/i.test(m.typeName))) return "online";
  for (const m of timedMeetings(s)) {
    if (m.days.some((d) => prefs.daysOff.includes(d))) return "day off";
    if (prefs.earliestStart !== null && m.start! < prefs.earliestStart) return "too early";
    if (prefs.latestEnd !== null && m.end! > prefs.latestEnd) return "too late";
    for (const b of prefs.busy)
      if (m.days.some((d) => b.days.includes(d)) && m.start! < b.end && b.start < m.end!) return `busy (${b.label})`;
  }
  return null;
}

function groupsOf(course: Course): string[] {
  return [...new Set(course.sections.map((s) => s.group))];
}

/** Letters shared by two or more components; sections with other letters only pair with each other. */
function linkedLetters(course: Course): Set<string> {
  const byGroup = new Map<string, Set<string>>();
  for (const s of course.sections) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, new Set());
    byGroup.get(s.group)!.add(s.code[0]?.toUpperCase() ?? "");
  }
  const counts = new Map<string, number>();
  for (const set of byGroup.values()) for (const l of set) counts.set(l, (counts.get(l) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 2).map(([l]) => l));
}

function statusPenalty(s: Section, a: AccessResult): number {
  let p = 0;
  if (s.status === "closed") p += 20;
  if (s.status === "pending") p += 1;
  if (a.access === "warn") p += 2;
  if (a.access === "blocked") p += 10;
  return p;
}

export function buildOptions(
  course: Course,
  profile: StudentProfile,
  prefs: Preferences,
  gpa: GpaIndex,
): { options: CourseOption[]; reason: string | null } {
  const groups = groupsOf(course);
  const pinned = prefs.pinned[course.id] ?? [];
  const letters = course.linkedByLetter ? linkedLetters(course) : null;

  const access = new Map<string, AccessResult>();
  const byGroup = new Map<string, Section[]>();
  const dropped = new Map<string, Map<string, number>>();
  for (const g of groups) { byGroup.set(g, []); dropped.set(g, new Map()); }

  for (const s of course.sections) {
    const a = evaluateAccess(s, profile);
    access.set(s.crn, a);
    const pinnedInGroup = course.sections.some((x) => x.group === s.group && pinned.includes(x.crn));
    if (pinnedInGroup && !pinned.includes(s.crn)) continue;
    const why = pinned.includes(s.crn) ? null : sectionFilter(s, a, prefs);
    if (why) {
      const d = dropped.get(s.group)!;
      d.set(why, (d.get(why) ?? 0) + 1);
      continue;
    }
    byGroup.get(s.group)!.push(s);
  }

  for (const g of groups) {
    if (byGroup.get(g)!.length === 0) {
      const why = [...dropped.get(g)!].map(([r, n]) => `${n} ${r}`).join(", ");
      return { options: [], reason: `No ${g} section left (${why || "none offered"})` };
    }
  }

  // Cartesian product across components, honoring first-letter linking.
  const key = (s: Section) => {
    if (!letters) return "*";
    const l = s.code[0]?.toUpperCase() ?? "";
    return letters.has(l) ? l : "*";
  };
  let combos: Section[][] = [[]];
  for (const g of groups) {
    const next: Section[][] = [];
    for (const partial of combos) {
      const k = partial.length ? key(partial[0]) : null;
      for (const s of byGroup.get(g)!) if (k === null || key(s) === k) next.push([...partial, s]);
    }
    combos = next;
    if (combos.length > 20000) break; // safety valve for unusual courses
  }
  if (combos.length === 0 || combos[0].length !== groups.length)
    return { options: [], reason: "No valid combination of linked sections" };

  const courseGpa = gpa[course.id];
  const raw: CourseOption[] = combos.map((sections) => {
    const lecture = sections.find((s) => s.group === "lecture") ?? sections[0];
    const g = sectionGpa(courseGpa, lecture);
    const acc = sections.map((s) => access.get(s.crn)!);
    return {
      courseId: course.id,
      sections,
      mask: sectionMask(sections),
      sameTime: [],
      instructorGpa: g?.gpa ?? null,
      instructorName: g?.name ?? null,
      gpaDelta: g && courseGpa && g.students >= 30 ? Math.round((g.gpa - courseGpa.course.gpa) * 100) / 100 : null,
      penalty: sections.reduce((p, s, i) => p + statusPenalty(s, acc[i]), 0),
      access: acc,
    };
  });

  // Collapse options with identical times; keep the best one as representative.
  const optionValue = (o: CourseOption) => (o.gpaDelta ?? 0) * 10 * prefs.weights.gpa - o.penalty;
  const bySig = new Map<string, CourseOption[]>();
  for (const o of raw) {
    const sig = o.mask.join(",");
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig)!.push(o);
  }
  const options = [...bySig.values()].map((list) => {
    list.sort((a, b) => optionValue(b) - optionValue(a));
    return { ...list[0], sameTime: list.slice(1) };
  });
  options.sort((a, b) => optionValue(b) - optionValue(a));
  return { options, reason: null };
}

// ---- scoring a full schedule ----

function metrics(options: CourseOption[]) {
  const perDay: [number, number][][] = DAYS.map(() => []);
  for (const o of options)
    for (const s of o.sections)
      for (const m of timedMeetings(s))
        for (const d of m.days) perDay[DAYS.indexOf(d)].push([m.start!, m.end!]);
  let gapMin = 0;
  let days = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  let lateStartPenalty = 0;
  for (const list of perDay) {
    if (!list.length) continue;
    days++;
    list.sort((a, b) => a[0] - b[0]);
    let end = list[0][1];
    for (const [s, e] of list.slice(1)) {
      if (s > end + 10) gapMin += s - end; // a 10-minute passing period is not a gap
      end = Math.max(end, e);
    }
    earliest = earliest === null ? list[0][0] : Math.min(earliest, list[0][0]);
    latest = latest === null ? end : Math.max(latest, end);
    lateStartPenalty += Math.max(0, 10 * 60 - list[0][0]) / 60; // hours before 10am
  }
  return { gapHours: gapMin / 60, days, earliest, latest, lateStartPenalty };
}

export function scoreSchedule(options: CourseOption[], optionalCount: number, prefs: Preferences) {
  const m = metrics(options);
  const deltas = options.map((o) => o.gpaDelta).filter((d): d is number => d !== null);
  const gpaTerm = deltas.reduce((a, b) => a + b, 0) * 10;
  const score =
    optionalCount * 100 +
    prefs.weights.gpa * gpaTerm -
    prefs.weights.gaps * m.gapHours * 2 -
    prefs.weights.fewerDays * m.days * 3 -
    prefs.weights.lateStart * m.lateStartPenalty * 2 -
    options.reduce((p, o) => p + o.penalty, 0);
  return {
    score: Math.round(score * 10) / 10,
    metrics: {
      daysOnCampus: m.days,
      gapHours: Math.round(m.gapHours * 10) / 10,
      earliest: m.earliest,
      latest: m.latest,
      avgGpaDelta: deltas.length ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) / 100 : null,
    },
  };
}

// ---- search ----

const NODE_LIMIT = 400_000;

export function solve(
  cart: CartItem[],
  catalog: Map<string, Course>,
  profile: StudentProfile,
  prefs: Preferences,
  gpa: GpaIndex,
): SolveResult {
  const diagnoses: CourseDiagnosis[] = [];
  const req: { id: string; options: CourseOption[]; hours: number }[] = [];
  const opt: typeof req = [];
  for (const item of cart) {
    const course = catalog.get(item.courseId);
    if (!course) {
      diagnoses.push({ courseId: item.courseId, options: 0, reason: "Not offered this term" });
      continue;
    }
    const { options, reason } = buildOptions(course, profile, prefs, gpa);
    diagnoses.push({ courseId: course.id, options: options.length, reason });
    (item.required ? req : opt).push({ id: course.id, options, hours: course.minHours });
  }

  const clashes: [string, string][] = [];
  for (let i = 0; i < req.length; i++)
    for (let j = i + 1; j < req.length; j++) {
      const a = req[i].options, b = req[j].options;
      if (!a.length || !b.length) continue;
      if (!a.some((x) => b.some((y) => !overlaps(x.mask, y.mask)))) clashes.push([req[i].id, req[j].id]);
    }

  if (req.some((r) => r.options.length === 0) || clashes.length)
    return { schedules: [], diagnoses, clashes, searched: 0, truncated: false };

  // Most constrained first keeps the tree small.
  req.sort((a, b) => a.options.length - b.options.length);
  const levels = [...req.map((r) => ({ ...r, required: true })), ...opt.map((o) => ({ ...o, required: false }))];

  // Score each complete schedule as it is found and keep only the best ones.
  const optionalIds = opt.map((o) => o.id);
  let best: Schedule[] = [];
  const keep = Math.max(prefs.maxResults, 1);
  const masks = Array.from({ length: levels.length + 1 }, () => new Uint32Array(MASK_WORDS));
  const picks: CourseOption[] = [];
  let nodes = 0;
  let truncated = false;

  const record = (optional: number, hours: number) => {
    const { score, metrics } = scoreSchedule(picks, optional, prefs);
    if (best.length >= keep * 4) {
      best.sort((a, b) => b.score - a.score);
      best = best.slice(0, keep);
    }
    if (best.length >= keep && score <= best[keep - 1].score) return;
    const ids = new Set(picks.map((p) => p.courseId));
    best.push({ options: [...picks], score, hours, metrics, missingOptional: optionalIds.filter((x) => !ids.has(x)) });
  };

  const dfs = (i: number, optional: number, hours: number) => {
    if (truncated) return;
    if (++nodes > NODE_LIMIT) { truncated = true; return; }
    if (i === levels.length) { record(optional, hours); return; }
    const lvl = levels[i];
    const cur = masks[i];
    const nxt = masks[i + 1];
    const canAdd = prefs.maxHours === null || hours + lvl.hours <= prefs.maxHours;
    if (canAdd || lvl.required) {
      for (const o of lvl.options) {
        if (overlaps(cur, o.mask)) continue;
        for (let w = 0; w < MASK_WORDS; w++) nxt[w] = cur[w] | o.mask[w];
        picks.push(o);
        dfs(i + 1, optional + (lvl.required ? 0 : 1), hours + lvl.hours);
        picks.pop();
        if (truncated) return;
      }
    }
    if (!lvl.required) {
      nxt.set(cur);
      dfs(i + 1, optional, hours);
    }
  };
  dfs(0, 0, 0);

  const schedules = best.sort((a, b) => b.score - a.score).slice(0, prefs.maxResults);
  return { schedules, diagnoses, clashes, searched: nodes, truncated };
}

/**
 * Re-solve after a section closes or a student wants a different one: keep every other
 * course in `current` pinned to its sections and search alternatives for `courseId` only.
 */
export function findReplacement(
  current: Schedule,
  courseId: string,
  cart: CartItem[],
  catalog: Map<string, Course>,
  profile: StudentProfile,
  prefs: Preferences,
  gpa: GpaIndex,
): SolveResult {
  const pinned: Record<string, string[]> = { ...prefs.pinned };
  for (const o of current.options) if (o.courseId !== courseId) pinned[o.courseId] = o.sections.map((s) => s.crn);
  delete pinned[courseId];
  const old = current.options.find((o) => o.courseId === courseId);
  const excluded = [...prefs.excluded, ...(old?.sections.filter((s) => s.status === "closed").map((s) => s.crn) ?? [])];
  return solve(cart, catalog, profile, { ...prefs, pinned, excluded }, gpa);
}
