"use client";

import { useMemo, useState } from "react";
import { needsText, parseAudit, takenIds, type Audit } from "@/lib/audit";
import { looksLikeAudit } from "@/lib/auditImport";
import { serializeAuditHtml } from "@/lib/auditDom";
import { GEN_ED_LABELS, type TermIndex } from "@/lib/data";
import {
  buildNeedPlans,
  buildRoadmap,
  currentTerm,
  hoursOf,
  nextTerm,
  termName,
  termSeason,
  type Candidate,
  type NeedPlan,
  type Season,
} from "@/lib/plan";
import type { StudentProfile } from "@/lib/restrictions";

interface Props {
  auditText: string | null;
  setAuditText: (t: string | null) => void;
  index: TermIndex | null;
  profile: StudentProfile;
  cartIds: Set<string>;
  onAddToCart: (ids: string[], required: boolean) => void;
  onOpenSchedule: () => void;
}

const UACHIEVE = "https://uachieve.apps.uillinois.edu/uachieve_uiuc/audit/list.html";

function title(s: string): string {
  return s.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase()).replace(/\bMse\b/g, "MSE").replace(/\bU\.s\./g, "U.S.").replace(/ And /g, " and ").replace(/ Of /g, " of ").replace(/ For /g, " for ").replace(/ The /g, " the ");
}

export default function DegreeView({ auditText, setAuditText, index, profile, cartIds, onAddToCart, onOpenSchedule }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [maxHours, setMaxHours] = useState(17);
  const [open, setOpen] = useState<string | null>(null);

  const audit: Audit | null = useMemo(() => {
    if (!auditText) return null;
    try { return parseAudit(auditText); } catch { return null; }
  }, [auditText]);

  const indexSeason: Season = index ? termSeason(index.term) : "fa";
  const target = audit ? nextTerm(currentTerm(audit)) : "";
  const plans = useMemo(
    () => (audit && index ? buildNeedPlans(audit, index.courses, termSeason(target), indexSeason, profile) : []),
    [audit, index, target, indexSeason, profile],
  );
  const roadmap = useMemo(() => {
    if (!audit || !index) return null;
    const cache = new Map<Season, NeedPlan[]>();
    const plansFor = (s: Season) => {
      if (!cache.has(s)) cache.set(s, buildNeedPlans(audit, index.courses, s, indexSeason, profile));
      return cache.get(s)!;
    };
    return buildRoadmap(audit, plansFor, { maxHours, terms: 10 }, index.courses);
  }, [audit, index, indexSeason, profile, maxHours]);

  const importText = (text: string) => {
    if (!looksLikeAudit(text)) {
      setError("That doesn't look like a uAchieve audit. Open your audit, press Cmd+A (Ctrl+A on Windows) to select everything, copy, and paste here.");
      return;
    }
    const a = parseAudit(text);
    if (!a.requirements.length) { setError("No requirements found in the pasted text. Copy the whole audit page, not just part of it."); return; }
    setError(null);
    setAuditText(text);
    setDraft("");
  };

  const importFile = async (file: File) => {
    const raw = await file.text();
    const isHtml = /<html|<div class="requirement/i.test(raw);
    importText(isHtml ? serializeAuditHtml(raw) : raw);
  };

  // ---------- import screen ----------
  if (!audit) {
    return (
      <div className="degree">
        <div className="panel import">
          <h2>Import your degree audit</h2>
          <div className="body">
            <p>The planner reads your uAchieve audit to see what you&apos;ve taken and what&apos;s left, then lists the courses that can fill each remaining requirement and lays out a plan to graduation. It works for any major or minor.</p>
            <ol className="steps">
              <li>Open <a href={UACHIEVE} target="_blank" rel="noreferrer">uAchieve</a>, sign in, and open your latest audit (run a new one if it&apos;s old).</li>
              <li>Click anywhere on the audit, press <kbd>Cmd</kbd>+<kbd>A</kbd> then <kbd>Cmd</kbd>+<kbd>C</kbd> (Windows: <kbd>Ctrl</kbd>).</li>
              <li>Paste it below.</li>
            </ol>
            <textarea className="paste" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste your whole audit here" aria-label="Audit text" rows={8} />
            {error && <p className="notice bad" role="alert" style={{ margin: "8px 0" }}>{error}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => importText(draft)} disabled={!draft.trim()}>Import audit</button>
              <span className="small">Your audit stays in this browser. It is never uploaded.</span>
            </div>
            <p className="small">
              Or upload the audit page saved from your browser (File → Save Page As):{" "}
              <input type="file" accept=".html,.htm,.txt" aria-label="Upload saved audit page"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
            </p>
            <p className="small" style={{ marginBottom: 0 }}>With the Illini Course Planner browser extension, an &quot;Open in Illini Course Planner&quot; button appears on the audit page itself.</p>
          </div>
        </div>
      </div>
    );
  }

  const { done, inProgress } = takenIds(audit);
  const totals = audit.totalHours;
  // "OR)" sub-requirements are another way to meet their requirement: show them as a note on
  // the sibling row instead of a separate need.
  const orSubs = plans.filter((p) => p.need.sub?.number === "OR)");
  const needPlans = plans.filter((p) => p.need.sub?.number !== "OR)");
  const orNote = (p: NeedPlan): string | null => {
    const alt = orSubs.find((o) => o.need.requirement.id === p.need.requirement.id);
    if (!alt?.need.sub) return null;
    const taking = alt.need.sub.taken.map((c) => `${c.subject} ${c.number}${c.inProgress ? " (in progress)" : ""}`).join(", ");
    const planned = roadmap?.terms.flatMap((t) => t.items).find((i) => i.needLabel !== p.need.label && alt.candidates.some((c) => c.row.id === i.id) && /CORE|REQUIRED/i.test(i.needLabel));
    return `Or finish the ${title(alt.need.label).toLowerCase()}: ${taking}${planned ? ` + ${planned.id}, already in your plan` : ""}.`;
  };
  const reqsDone = audit.requirements.filter((r) => r.kind !== "summary" && r.status === "complete");
  const firstTerm = roadmap?.terms[0];

  return (
    <div className="degree">
      <div className="panel">
        <div className="body degree-head">
          <div>
            <h2 style={{ padding: 0 }}>{audit.program || "Your degree"}</h2>
            <div className="small">Catalog {audit.catalogYear.slice(0, 4)}–{Number(audit.catalogYear.slice(0, 4)) + 1} · audit from {audit.preparedOn.split(" ")[0]} · {done.size} courses done, {inProgress.size} in progress</div>
          </div>
          {totals && (
            <div className="hours-meter" aria-label={`${totals.earned} of ${totals.required} hours including in progress`}>
              <div className="bar"><span style={{ width: `${Math.min(100, (totals.earned / totals.required) * 100)}%` }} /></div>
              <div className="small"><b>{totals.earned}</b> of {totals.required} hours (incl. {totals.inProgress} in progress)</div>
            </div>
          )}
          <div className="row">
            <button className="secondary" onClick={() => setAuditText(null)}>Import a newer audit</button>
          </div>
        </div>
      </div>

      {roadmap && (
        <div className="panel">
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ padding: 0 }}>Your plan to graduate</h2>
              <div className="small">
                {roadmap.terms.length
                  ? <>Finishes <b>{termName(roadmap.terms[roadmap.terms.length - 1].term)}</b> in {roadmap.terms.length} semester{roadmap.terms.length > 1 ? "s" : ""}. Required courses with prerequisites go first; electives fill the rest, preferring courses that count twice.</>
                  : "Nothing left to plan."}
              </div>
            </div>
            <label className="small row">Max hours per term
              <input type="range" min={12} max={20} value={maxHours} onChange={(e) => setMaxHours(Number(e.target.value))} aria-label="Max hours per term" />
              <b>{maxHours}</b>
            </label>
          </div>
          <div className="roadmap">
            {roadmap.terms.map((t, ti) => (
              <div className="term" key={t.term}>
                <div className="term-head"><b>{termName(t.term)}</b><span className="small">{t.hours} h</span></div>
                <ul>
                  {t.items.map((i, k) => (
                    <li key={k} className={i.prereqFor ? "pre" : ""}>
                      <span className="cid">{i.id}</span>
                      <span className="small">{i.title}</span>
                      <span className="need">{i.prereqFor ? `Needed first for ${i.prereqFor}` : title(i.needLabel)}</span>
                    </li>
                  ))}
                </ul>
                {ti === 0 && (
                  <button className="secondary" style={{ margin: "0 10px 10px" }}
                    onClick={() => { onAddToCart(t.items.map((i) => i.id), true); onOpenSchedule(); }}>
                    Build this schedule
                  </button>
                )}
              </div>
            ))}
          </div>
          {roadmap.unplaced.length > 0 && (
            <div className="notice bad" style={{ marginTop: 0 }}>
              <b>Couldn&apos;t place:</b>
              <ul>{roadmap.unplaced.map((u) => <li key={u.id}>{title(u.id)}: {u.note}</li>)}</ul>
            </div>
          )}
          <p className="small" style={{ padding: "0 14px 12px", margin: 0 }}>
            {termName(target)} sections aren&apos;t published yet, so seasons come from when each course ran in recent years. Electives are suggestions; swap any of them from the lists below.
            {firstTerm && index && termSeason(firstTerm.term) !== indexSeason && " The schedule builder uses the latest published term until then."}
          </p>
        </div>
      )}

      <div className="panel">
        <h2>What&apos;s left</h2>
        <div className="body">
          <ul className="needs">
            {needPlans.map((p) => {
              const key = p.need.key;
              const isOpen = open === key;
              const takeable = p.candidates.filter((c) => !c.blocked && c.prereq.state !== "missing" && c.offeredInSeason);
              return (
                <li key={key} className={isOpen ? "open" : ""}>
                  <button className="need-row" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                    <span>
                      <b>{title(p.need.label)}</b>
                      <span className="small"> {p.need.requirement.kind === "minor" ? title(p.need.requirement.title) : p.need.requirement.title !== p.need.label ? title(p.need.requirement.title) : ""}</span>
                    </span>
                    <span className="small">needs {needsText(p.need.needs) || "1"}</span>
                    <span className="small">{p.kind === "specific" ? p.candidates.map((c) => c.row.id).join(", ") : `${takeable.length} you can take in ${termName(target).split(" ")[0]}`}</span>
                    {orNote(p) && <span className="small or-note">{orNote(p)}</span>}
                  </button>
                  {isOpen && <NeedDetail plan={p} target={target} cartIds={cartIds} onAdd={(id) => onAddToCart([id], p.kind === "specific")} />}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <details className="panel">
        <summary>Completed ({reqsDone.length})</summary>
        <div className="body">
          <ul className="done-list">{reqsDone.map((r) => <li key={r.id}>{title(r.title)}</li>)}</ul>
        </div>
      </details>
    </div>
  );
}

function NeedDetail({ plan, target, cartIds, onAdd }: { plan: NeedPlan; target: string; cartIds: Set<string>; onAdd: (id: string) => void }) {
  const [onlyTakeable, setOnlyTakeable] = useState(plan.kind !== "specific");
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<"best" | "gpa">("best");
  let list = plan.candidates;
  if (onlyTakeable) list = list.filter((c) => !c.blocked && c.prereq.state !== "missing" && c.offeredInSeason);
  if (sort === "gpa") list = [...list].sort((a, b) => (b.row.gpa ?? 0) - (a.row.gpa ?? 0));
  const season = termName(target).split(" ")[0];

  return (
    <div className="need-detail">
      {plan.notes.length > 0 && <ul className="small notes">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {plan.kind !== "specific" && (
        <div className="row" style={{ marginBottom: 6 }}>
          <label className="check small"><input type="checkbox" checked={onlyTakeable} onChange={(e) => setOnlyTakeable(e.target.checked)} />Only courses I can take in {season}</label>
          <label className="small row">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as "best" | "gpa")}>
              <option value="best">Best fit (counts twice, then GPA)</option>
              <option value="gpa">Highest average GPA</option>
            </select>
          </label>
          <span className="small">{list.length} course{list.length === 1 ? "" : "s"}</span>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="prof cands">
          <thead>
            <tr><th>Course</th><th className="num">Hours</th><th className="num">GPA</th><th>{season}?</th><th>Prerequisites</th><th>Also counts for</th><th /></tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((c) => <CandRow key={c.row.id + (c.group ?? "")} c={c} inCart={cartIds.has(c.row.id)} onAdd={onAdd} />)}
          </tbody>
        </table>
      </div>
      {list.length > limit && <button className="secondary" onClick={() => setLimit(limit + 50)}>Show more</button>}
      {plan.source && <p className="small">Course list from the <a href={plan.source} target="_blank" rel="noreferrer">Academic Catalog</a> (the audit doesn&apos;t list these).</p>}
    </div>
  );
}

function CandRow({ c, inCart, onAdd }: { c: Candidate; inCart: boolean; onAdd: (id: string) => void }) {
  const r = c.row;
  const pre =
    c.prereq.state === "missing" ? <span className="delta down">needs {c.prereq.missing.join("; ")}</span>
    : c.prereq.state === "met" || c.prereq.state === "met-if-concurrent" ? <span className="delta up">met</span>
    : c.prereq.state === "none" ? <span className="small">none</span>
    : <span className="small" title={r.prereq}>check: {r.prereq.slice(0, 60)}{r.prereq.length > 60 ? "…" : ""}</span>;
  return (
    <tr className={c.blocked ? "thin" : ""}>
      <td>
        <b>{r.id}</b> <span className="small">{r.title}</span>
        {c.group && <span className="tag" style={{ marginLeft: 6 }}>{c.group}</span>}
        {r.genEd.length > 0 && <div className="small">{r.genEd.map((g) => GEN_ED_LABELS[g] ?? g).join(", ")}</div>}
        {c.blocked && <div className="small delta down">{c.blocked}</div>}
      </td>
      <td className="num">{r.hours ? hoursOf(r) : "–"}</td>
      <td className="num">{r.gpa?.toFixed(2) ?? "–"}</td>
      <td>{c.offeredInSeason ? "yes" : <span className="small">{r.seasons ? `usually ${r.seasons.split(" ").map((s) => ({ fa: "fall", sp: "spring", su: "summer", wi: "winter" } as Record<string, string>)[s]).join("/")}` : "not recently"}</span>}</td>
      <td>{pre}</td>
      <td className="small">{c.alsoFills.map(title).join(", ")}</td>
      <td>
        <button className="secondary" style={{ padding: "2px 8px", whiteSpace: "nowrap" }} disabled={inCart} onClick={() => onAdd(r.id)}>
          {inCart ? "In schedule" : "Add"}
        </button>
      </td>
    </tr>
  );
}
