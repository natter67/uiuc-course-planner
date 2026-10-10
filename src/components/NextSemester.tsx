"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import WeekGrid from "./WeekGrid";
import { title } from "./DegreeView";
import { loadCourses, termLabel } from "@/lib/data";
import { formatTime } from "@/lib/normalize";
import { hoursOf, termName, type PlannedItem } from "@/lib/plan";
import type { StudentProfile } from "@/lib/restrictions";
import { DEFAULT_PREFS, type SolveResult } from "@/lib/solver";
import type { SolveRequest } from "@/lib/solver.worker";
import type { PlanState } from "@/lib/usePlan";

const COLORS = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];

interface Props {
  plan: PlanState;
  /** Term whose sections we schedule with: the target term if published, else the same season last year. */
  scheduleTerm: string | null;
  isEstimate: boolean;
  profile: StudentProfile;
  example: boolean;
  onOpenInBuilder: (ids: string[], term: string) => void;
  onSeeFullPlan: () => void;
  onExitExample: () => void;
}

function badge(i: PlannedItem): { label: string; cls: string } {
  if (i.kind === "prereq") return { label: "Prerequisite", cls: "b-pre" };
  if (i.reqKind === "minor") return { label: "Minor", cls: "b-minor" };
  if (i.reqKind === "gened") return { label: "Gen ed", cls: "b-gened" };
  if (i.kind === "specific") return { label: "Required", cls: "b-req" };
  return { label: "Elective", cls: "b-elective" };
}

export default function NextSemester({ plan, scheduleTerm, isEstimate, profile, example, onOpenInBuilder, onSeeFullPlan, onExitExample }: Props) {
  const { audit, roadmap, plans, target } = plan;
  const first = roadmap?.terms[0];
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [swapOpen, setSwapOpen] = useState<string | null>(null);

  useEffect(() => setSwaps({}), [first?.term, audit]);

  // The recommended items, with any electives the student swapped.
  const items = useMemo(() => {
    if (!first) return [];
    return first.items.map((i) => {
      const to = swaps[i.id];
      if (!to) return i;
      const p = plans.find((x) => x.need.label === i.needLabel);
      const c = p?.candidates.find((x) => x.row.id === to);
      return { ...i, id: to, title: c?.row.title ?? "", hours: c ? hoursOf(c.row) : i.hours, reasons: [`Fills: ${title(i.needLabel)}`, ...(c?.alsoFills.length ? [`Also counts for ${c.alsoFills.map(title).join(" and ")}`] : [])] };
    });
  }, [first, swaps, plans]);
  const ids = useMemo(() => [...new Set(items.map((i) => i.id))], [items]);
  const hours = items.reduce((h, i) => h + i.hours, 0);

  // ---- schedule preview ----
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solving, setSolving] = useState(false);
  const [pick, setPick] = useState(0);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL("../lib/solver.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<{ id: number; result: SolveResult }>) => {
      if (e.data.id !== reqId.current) return;
      setResult(e.data.result);
      setSolving(false);
      setPick(0);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (!scheduleTerm || !ids.length) return;
    let cancelled = false;
    setSolving(true);
    loadCourses(scheduleTerm, ids).then(({ courses, gpa }) => {
      if (cancelled || !worker.current) return;
      reqId.current += 1;
      // Seat status from a past term means nothing for next term, so plan with every section.
      const prefs = { ...DEFAULT_PREFS, includeClosed: true, maxResults: 20 };
      const msg: SolveRequest = { id: reqId.current, kind: "solve", cart: ids.map((courseId) => ({ courseId, required: true })), courses, profile, prefs, gpa };
      worker.current.postMessage(msg);
    });
    return () => { cancelled = true; };
  }, [scheduleTerm, ids, profile]);

  if (!audit || !roadmap) return null;
  const last = roadmap.terms[roadmap.terms.length - 1];
  const schedule = result?.schedules[pick] ?? null;
  const colorOf = (id: string) => COLORS[Math.max(0, ids.indexOf(id)) % COLORS.length];
  const missingFromTerm = result?.diagnoses.filter((d) => d.reason) ?? [];

  if (!first) {
    return (
      <div className="next"><div className="panel"><div className="body">
        <h2 style={{ padding: 0 }}>Nothing left to plan</h2>
        <p>Your audit shows no remaining requirements the planner can fill. Check the full plan for anything it couldn&apos;t place.</p>
      </div></div></div>
    );
  }

  return (
    <div className="next">
      {example && (
        <div className="notice example-bar">
          You&apos;re looking at an example MatSE junior.{" "}
          <button className="primary" onClick={onExitExample}>Use my own audit</button>
        </div>
      )}

      <header className="next-head">
        <div>
          <h1>{termName(first.term)}: {items.length} courses, {hours} hours</h1>
          <p>
            Keeps you on track to graduate in <b>{termName(last.term)}</b>
            {roadmap.unplaced.length ? ", with a few requirements still to place." : "."}{" "}
            <button className="link" onClick={onSeeFullPlan}>See the full plan</button>
          </p>
        </div>
      </header>

      <div className="next-grid">
        <section className="panel">
          <h2>What to take</h2>
          <ul className="recs">
            {items.map((i, k) => {
              const b = badge(i);
              const orig = first.items[k];
              const need = plans.find((p) => p.need.label === orig.needLabel);
              const swappable = need && need.kind !== "specific" && !orig.prereqFor;
              const options = swappable
                ? need!.candidates.filter((c) => !c.blocked && c.offeredInSeason && c.prereq.state !== "missing" && !ids.includes(c.row.id) && hoursOf(c.row) >= 3).slice(0, 8)
                : [];
              return (
                <li key={k} style={{ ["--c" as string]: colorOf(i.id) }}>
                  <div className="rec-top">
                    <span className="rec-id">{i.id}</span>
                    <span className={`badge ${b.cls}`}>{b.label}</span>
                    <span className="small rec-hours">{i.hours} h</span>
                  </div>
                  <div className="rec-title">{i.title}</div>
                  <ul className="reasons-list">
                    {(i.reasons ?? []).slice(0, 3).map((r, j) => <li key={j} className={j === 0 && /Needed|Only offered/.test(r) ? "key" : ""}>{r}</li>)}
                  </ul>
                  {swappable && options.length > 0 && (
                    <div className="swap">
                      {swapOpen === orig.id ? (
                        <select autoFocus aria-label={`Swap ${i.id}`} value={swaps[orig.id] ?? ""}
                          onChange={(e) => { setSwaps({ ...swaps, [orig.id]: e.target.value }); setSwapOpen(null); }}
                          onBlur={() => setSwapOpen(null)}>
                          <option value="" disabled>Pick another {title(orig.needLabel).toLowerCase()}…</option>
                          {options.map((c) => (
                            <option key={c.row.id} value={c.row.id}>
                              {c.row.id} {c.row.title} {c.row.gpa ? `· GPA ${c.row.gpa.toFixed(2)}` : ""}{c.alsoFills.length ? " · counts twice" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button className="link" onClick={() => setSwapOpen(orig.id)}>Swap for another</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <div className="toolbar">
            <div>
              <h2 style={{ padding: 0 }}>A week that fits</h2>
              <div className="small">
                {isEstimate && scheduleTerm
                  ? <>{termName(target)} times aren&apos;t out yet, so this uses {termLabel(scheduleTerm)} times. Most courses keep similar times year to year.</>
                  : scheduleTerm ? <>Using {termLabel(scheduleTerm)} sections.</> : "No section data for this term yet."}
              </div>
            </div>
            <div className="pager" style={{ marginLeft: "auto" }}>
              <button onClick={() => setPick(Math.max(0, pick - 1))} disabled={!schedule || pick === 0} aria-label="Previous option">‹</button>
              <span className="count" aria-live="polite">{solving ? "Fitting…" : result?.schedules.length ? `Option ${pick + 1} of ${result.schedules.length}` : "No fit"}</span>
              <button onClick={() => setPick(Math.min((result?.schedules.length ?? 1) - 1, pick + 1))} disabled={!schedule || pick >= (result?.schedules.length ?? 0) - 1} aria-label="Next option">›</button>
            </div>
          </div>
          {schedule && (
            <div className="facts" style={{ padding: "8px 14px 0" }}>
              <span><b>{schedule.metrics.daysOnCampus}</b> days on campus</span>
              <span><b>{schedule.metrics.gapHours}</b> h of gaps</span>
              {schedule.metrics.earliest !== null && <span>first class <b>{formatTime(schedule.metrics.earliest)}</b></span>}
            </div>
          )}
          {missingFromTerm.length > 0 && (
            <div className="notice" style={{ margin: "10px 14px 0" }}>
              {missingFromTerm.map((d) => `${d.courseId}: ${d.reason?.toLowerCase()}`).join("; ")}. The rest are scheduled below.
            </div>
          )}
          {result && !result.schedules.length && !solving && (
            <div className="notice bad" style={{ margin: "10px 14px 0" }}>
              These courses can&apos;t all fit with {scheduleTerm ? termLabel(scheduleTerm) : "these"} times
              {result.clashes.length ? ` (${result.clashes.map(([a, b]) => `${a} and ${b} overlap`).join("; ")})` : ""}. Swap an elective, or open the schedule builder to try more options.
            </div>
          )}
          <WeekGrid schedule={schedule} colorOf={colorOf} busy={[]} selected={null} onSelect={() => {}} hideStatus={isEstimate} />
          <div className="row" style={{ padding: "0 14px 14px" }}>
            <button className="primary" disabled={!scheduleTerm} onClick={() => scheduleTerm && onOpenInBuilder(ids, scheduleTerm)}>
              Customize in schedule builder
            </button>
            <span className="small">Set days off, class times and professors there.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
