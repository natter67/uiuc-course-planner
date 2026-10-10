"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CourseDetail from "./CourseDetail";
import DegreeView from "./DegreeView";
import NextSemester from "./NextSemester";
import Welcome from "./Welcome";
import { takeAuditFromUrl } from "@/lib/auditImport";
import { termSeason } from "@/lib/plan";
import { usePlan } from "@/lib/usePlan";
import WeekGrid from "./WeekGrid";
import { GEN_ED_LABELS, loadCourses, loadIndex, loadTerms, termLabel, type TermIndex } from "@/lib/data";
import { formatTime } from "@/lib/normalize";
import { DEFAULT_PROFILE, type Standing, type StudentProfile } from "@/lib/restrictions";
import { DEFAULT_PREFS, type CartItem, type Preferences, type SolveResult } from "@/lib/solver";
import type { SolveRequest } from "@/lib/solver.worker";
import type { Course, Day, GpaIndex } from "@/lib/types";

const COLORS = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
const DAY_LETTERS: Day[] = ["M", "T", "W", "R", "F"];
const TIME_CHOICES = Array.from({ length: 31 }, (_, i) => 7 * 60 + i * 30); // 7:00 to 22:00

function useStored<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        setValue(Array.isArray(initial) ? parsed : ({ ...initial, ...parsed } as T));
      }
    } catch { /* storage unavailable */ }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue];
}

export default function Planner() {
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState<string>("");
  const [index, setIndex] = useState<TermIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<"next" | "plan" | "schedule">("next");
  const [auditText, setAuditTextState] = useState<string | null>(null);
  const [example, setExample] = useState(false);
  const setAuditText = (t: string | null, isExample = false) => {
    setAuditTextState(t);
    setExample(isExample);
    // An example audit is never saved: reloading brings you back to the start screen.
    try { if (t && !isExample) localStorage.setItem("planner.audit", t); else localStorage.removeItem("planner.audit"); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    (async () => {
      const fromUrl = await takeAuditFromUrl();
      if (fromUrl) { setAuditText(fromUrl); setTab("next"); return; }
      try { const saved = localStorage.getItem("planner.audit"); if (saved) setAuditTextState(saved); } catch { /* storage unavailable */ }
    })();
  }, []);

  const [cart, setCart] = useStored<CartItem[]>("planner.cart", []);
  const [prefs, setPrefs] = useStored<Preferences>("planner.prefs", DEFAULT_PREFS);
  const [profile, setProfile] = useStored<StudentProfile>("planner.profile", DEFAULT_PROFILE);

  const [courses, setCourses] = useState<Course[]>([]);
  const [gpa, setGpa] = useState<GpaIndex>({});
  const [result, setResult] = useState<SolveResult | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [solving, setSolving] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [genEd, setGenEd] = useState<string | null>(null);
  const [sortByGpa, setSortByGpa] = useState(false);

  // ---- data loading ----
  const [planIndex, setPlanIndex] = useState<TermIndex | null>(null);
  const [maxHours, setMaxHours] = useState(17);
  useEffect(() => {
    loadTerms()
      .then((t) => {
        setTerms(t);
        setTerm((cur) => cur || t[0] || "");
        if (t[0]) loadIndex(t[0]).then(setPlanIndex).catch((e) => setLoadError(String(e)));
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const plan = usePlan(auditText, planIndex, profile, maxHours);
  // Sections to schedule next term with: the term itself once published, else the same season last year.
  const { scheduleTerm, isEstimate } = useMemo(() => {
    if (!plan.target) return { scheduleTerm: null, isEstimate: false };
    const season = termSeason(plan.target);
    const exact = `20${plan.target.slice(2)}-${{ fa: "fall", sp: "spring", su: "summer" }[season]}`;
    if (terms.includes(exact)) return { scheduleTerm: exact, isEstimate: false };
    const same = terms.find((t) => termSeason(t) === season);
    return { scheduleTerm: same ?? null, isEstimate: true };
  }, [plan.target, terms]);
  const openInBuilder = (ids: string[], t: string) => {
    setTerm(t);
    setCart(ids.map((courseId) => ({ courseId, required: true })));
    setPrefs({ ...prefs, pinned: {}, excluded: [], includeClosed: isEstimate || prefs.includeClosed });
    setSelected(null);
    setTab("schedule");
  };
  useEffect(() => {
    if (!term) return;
    loadIndex(term).then(setIndex).catch((e) => setLoadError(String(e)));
  }, [term]);
  useEffect(() => {
    if (!term) return;
    const ids = cart.map((c) => c.courseId);
    loadCourses(term, ids).then(({ courses, gpa }) => { setCourses(courses); setGpa(gpa); }).catch((e) => setLoadError(String(e)));
  }, [term, cart]);

  // ---- solving in a worker ----
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL("../lib/solver.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<{ id: number; result: SolveResult; ms: number }>) => {
      if (e.data.id !== reqId.current) return; // a newer request superseded this one
      setResult(e.data.result);
      setMs(e.data.ms);
      setSolving(false);
      setCurrent(0);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const loadedIds = useMemo(() => new Set(courses.map((c) => c.id)), [courses]);
  const ready = cart.length > 0 && cart.every((c) => loadedIds.has(c.courseId) || !index?.courses.some((x) => x.id === c.courseId && x.inTerm));

  const post = useCallback((msg: SolveRequest extends infer R ? (R extends SolveRequest ? Omit<R, "id"> : never) : never) => {
    if (!worker.current) return;
    reqId.current += 1;
    setSolving(true);
    worker.current.postMessage({ ...msg, id: reqId.current } as SolveRequest);
  }, []);

  useEffect(() => {
    if (!ready) { if (!cart.length) setResult(null); return; }
    setReplacing(null);
    const t = setTimeout(() => post({ kind: "solve", cart, courses, profile, prefs, gpa }), 200);
    return () => clearTimeout(t);
  }, [ready, cart, courses, profile, prefs, gpa, post]);

  const schedule = result?.schedules[current] ?? null;

  // ---- helpers ----
  const colorOf = useCallback((id: string) => COLORS[Math.max(0, cart.findIndex((c) => c.courseId === id)) % COLORS.length], [cart]);
  const inCart = (id: string) => cart.some((c) => c.courseId === id);
  const addCourse = (id: string) => { if (!inCart(id)) setCart([...cart, { courseId: id, required: !genEd }]); setSelected(id); };
  const removeCourse = (id: string) => {
    setCart(cart.filter((c) => c.courseId !== id));
    const { [id]: _, ...rest } = prefs.pinned;
    setPrefs({ ...prefs, pinned: rest });
    if (selected === id) setSelected(null);
  };
  const toggleRequired = (id: string) => setCart(cart.map((c) => (c.courseId === id ? { ...c, required: !c.required } : c)));
  const setPref = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs({ ...prefs, [k]: v });

  const results = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase().replace(/\s+/g, " ");
    let list = index.courses.filter((c) => {
      if (!c.inTerm) return false;
      if (genEd && !c.genEd.includes(genEd)) return false;
      if (!q) return !!genEd;
      return c.id.toLowerCase().includes(q) || c.id.toLowerCase().replace(" ", "").includes(q.replace(" ", "")) || c.title.toLowerCase().includes(q);
    });
    if (sortByGpa) list = [...list].sort((a, b) => (b.gpa ?? 0) - (a.gpa ?? 0));
    return list.slice(0, 60);
  }, [index, query, genEd, sortByGpa]);

  const genEdsInTerm = useMemo(() => {
    const s = new Set(index?.courses.flatMap((c) => c.genEd) ?? []);
    return Object.keys(GEN_ED_LABELS).filter((g) => s.has(g));
  }, [index]);

  const selectedCourse = courses.find((c) => c.id === selected) ?? null;
  const selectedOption = schedule?.options.find((o) => o.courseId === selected) ?? null;
  const pinnedSel = !!selected && !!prefs.pinned[selected];

  const togglePin = () => {
    if (!selected || !selectedOption) return;
    const { [selected]: existing, ...rest } = prefs.pinned;
    setPrefs({ ...prefs, pinned: existing ? rest : { ...rest, [selected]: selectedOption.sections.map((s) => s.crn) } });
  };
  const exclude = (crn: string) => setPrefs({ ...prefs, excluded: [...new Set([...prefs.excluded, crn])] });
  const replace = () => {
    if (!schedule || !selected) return;
    setReplacing(selected);
    post({ kind: "replace", current: schedule, courseId: selected, cart, courses, profile, prefs, gpa });
  };

  const missing = cart.filter((c) => index && !index.courses.some((x) => x.id === c.courseId && x.inTerm));
  const addMany = (ids: string[], required: boolean) => {
    const add = ids.filter((id) => !cart.some((c) => c.courseId === id));
    if (add.length) setCart([...cart, ...add.map((courseId) => ({ courseId, required }))]);
  };
  const cartIds = useMemo(() => new Set(cart.map((c) => c.courseId)), [cart]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Illini Course Planner</div>
        <nav className="tabs" aria-label="Views">
          <button aria-pressed={tab === "next"} onClick={() => setTab("next")}>Next semester</button>
          <button aria-pressed={tab === "plan"} onClick={() => setTab("plan")}>Plan to graduate</button>
          <button aria-pressed={tab === "schedule"} onClick={() => setTab("schedule")}>Schedule builder{cart.length ? ` (${cart.length})` : ""}</button>
        </nav>
        {tab === "schedule" && <>
        <label>Term
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            {terms.map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}
          </select>
        </label>
        <label>Standing
          <select value={profile.standing} onChange={(e) => setProfile({ ...profile, standing: e.target.value as Standing })}>
            {["Freshman", "Sophomore", "Junior", "Senior"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        </>}
      </header>

      {loadError && <div className="notice bad" role="alert">Couldn&apos;t load course data: {loadError}</div>}

      {tab !== "schedule" && !plan.audit && (
        <main className="degree-wrap">
          <Welcome onImport={(t, ex) => { setAuditText(t, !!ex); setTab("next"); }} />
        </main>
      )}
      {tab === "next" && plan.audit && (
        <main className="degree-wrap">
          {!planIndex ? <p className="hint">Loading courses…</p> : (
            <NextSemester plan={plan} scheduleTerm={scheduleTerm} isEstimate={isEstimate} profile={profile} example={example}
              onOpenInBuilder={openInBuilder} onSeeFullPlan={() => setTab("plan")} onExitExample={() => setAuditText(null)} />
          )}
        </main>
      )}
      {tab === "plan" && plan.audit && (
        <main className="degree-wrap">
          <DegreeView plan={plan} index={planIndex} maxHours={maxHours} setMaxHours={setMaxHours}
            cartIds={cartIds} onAddToCart={addMany} onOpenSchedule={() => setTab("schedule")}
            onBuildTerm={(ids) => scheduleTerm && openInBuilder(ids, scheduleTerm)}
            onReimport={() => { setAuditText(null); setTab("next"); }} />
        </main>
      )}
      <main className="layout" hidden={tab !== "schedule"}>
        {/* ---------- left: search, cart, preferences ---------- */}
        <div className="left-col">
          {missing.length > 0 && (
            <div className="notice" style={{ margin: "0 0 16px" }}>
              {missing.map((m) => m.courseId).join(", ")} {missing.length > 1 ? "aren't" : "isn't"} offered in {termLabel(term)}. They stay in your list for when the next term is published.
            </div>
          )}
          <div className="panel p-search">
            <h2>Add courses</h2>
            <div className="body">
              <input className="search" placeholder="Search, e.g. MSE 401 or calculus" value={query}
                onChange={(e) => setQuery(e.target.value)} aria-label="Search courses" />
              <div className="filters" role="group" aria-label="Gen ed filter">
                {genEdsInTerm.map((g) => (
                  <button key={g} className="chip" aria-pressed={genEd === g} onClick={() => setGenEd(genEd === g ? null : g)}>
                    {GEN_ED_LABELS[g]}
                  </button>
                ))}
              </div>
              {(query || genEd) && (
                <>
                  <label className="check" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={sortByGpa} onChange={(e) => setSortByGpa(e.target.checked)} />
                    Highest average GPA first
                  </label>
                  <ul className="results">
                    {results.length === 0 && <li className="hint" style={{ padding: "8px 0" }}>No courses match. This term&apos;s data may not include that subject yet.</li>}
                    {results.map((c) => (
                      <li key={c.id}>
                        <button className="result" onClick={() => addCourse(c.id)} disabled={inCart(c.id)}>
                          <span className="id">{c.id}{inCart(c.id) ? " (added)" : ""}</span>
                          <span className="title">{c.title} · {c.hours} · {c.open}/{c.sections} sections open</span>
                          <span className="gpa">{c.gpa !== null ? <><b>{c.gpa.toFixed(2)}</b>avg GPA</> : "no GPA data"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="panel p-cart">
            <h2>Your courses</h2>
            <div className="body">
              {cart.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>Search for courses and add them here. Mark gen eds you&apos;re flexible on as optional, and the planner fits in as many as it can.</p>
              ) : (
                <ul className="cart">
                  {cart.map((c) => {
                    const row = index?.courses.find((x) => x.id === c.courseId);
                    return (
                      <li key={c.courseId}>
                        <span className="swatch" style={{ background: colorOf(c.courseId) }} />
                        <button className="name" onClick={() => setSelected(c.courseId)}>
                          {c.courseId}{prefs.pinned[c.courseId] ? " (locked)" : ""}
                          <small>{row ? row.title : "Not offered this term"}</small>
                        </button>
                        <button className="toggle" aria-pressed={c.required} onClick={() => toggleRequired(c.courseId)}
                          title="Required courses must fit; optional ones are added when they can be">
                          {c.required ? "Required" : "Optional"}
                        </button>
                        <button className="icon-btn" onClick={() => removeCourse(c.courseId)} aria-label={`Remove ${c.courseId}`}>×</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {prefs.excluded.length > 0 && (
                <p className="small" style={{ marginBottom: 0 }}>
                  {prefs.excluded.length} section{prefs.excluded.length > 1 ? "s" : ""} excluded.{" "}
                  <button className="secondary" style={{ padding: "0 6px", fontSize: 12 }} onClick={() => setPref("excluded", [])}>Clear</button>
                </p>
              )}
            </div>
          </div>

          <div className="panel p-prefs">
            <details open>
            <summary>Preferences</summary>
            <div className="body prefs">
              <fieldset>
                <legend>Days off</legend>
                <div className="days">
                  {DAY_LETTERS.map((d) => (
                    <button key={d} aria-pressed={prefs.daysOff.includes(d)} aria-label={`Day off ${d}`}
                      onClick={() => setPref("daysOff", prefs.daysOff.includes(d) ? prefs.daysOff.filter((x) => x !== d) : [...prefs.daysOff, d])}>
                      {d}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Class hours</legend>
                <div className="row">
                  <select aria-label="No class before" value={prefs.earliestStart ?? ""} onChange={(e) => setPref("earliestStart", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Any start</option>
                    {TIME_CHOICES.filter((t) => t <= 12 * 60).map((t) => <option key={t} value={t}>Not before {formatTime(t)}</option>)}
                  </select>
                  <select aria-label="No class after" value={prefs.latestEnd ?? ""} onChange={(e) => setPref("latestEnd", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Any end</option>
                    {TIME_CHOICES.filter((t) => t >= 12 * 60).map((t) => <option key={t} value={t}>Done by {formatTime(t)}</option>)}
                  </select>
                </div>
              </fieldset>
              <fieldset>
                <legend>Sections to consider</legend>
                <label className="check"><input type="checkbox" checked={prefs.includeClosed} onChange={(e) => setPref("includeClosed", e.target.checked)} />Include closed sections (plan before seats open up)</label>
                <label className="check"><input type="checkbox" checked={prefs.includeBlocked} onChange={(e) => setPref("includeBlocked", e.target.checked)} />Include sections restricted to other students</label>
                <label className="check"><input type="checkbox" checked={prefs.avoidOnline} onChange={(e) => setPref("avoidOnline", e.target.checked)} />Skip online sections</label>
                <label className="check"><input type="checkbox" checked={profile.includeApprovalRequired} onChange={(e) => setProfile({ ...profile, includeApprovalRequired: e.target.checked })} />Include sections that need department approval</label>
              </fieldset>
              <fieldset>
                <legend>What matters most</legend>
                {([
                  ["gpa", "Easier graders"],
                  ["gaps", "Fewer gaps"],
                  ["fewerDays", "Fewer days"],
                  ["lateStart", "Later mornings"],
                ] as const).map(([k, label]) => (
                  <label className="slider" key={k}>
                    {label}
                    <input type="range" min={0} max={3} step={0.5} value={prefs.weights[k]}
                      onChange={(e) => setPref("weights", { ...prefs.weights, [k]: Number(e.target.value) })} />
                  </label>
                ))}
              </fieldset>
              <button className="secondary" onClick={() => setPrefs(DEFAULT_PREFS)}>Reset preferences</button>
            </div>
            </details>
          </div>
        </div>

        {/* ---------- center: schedules ---------- */}
        <div className="panel p-schedule">
          <div className="toolbar">
            <div className="pager">
              <button onClick={() => setCurrent(Math.max(0, current - 1))} disabled={!schedule || current === 0} aria-label="Previous schedule">‹</button>
              <span className="count" aria-live="polite">
                {solving ? "Solving…" : result?.schedules.length ? `${current + 1} of ${result.schedules.length}` : "No schedules"}
              </span>
              <button onClick={() => setCurrent(Math.min((result?.schedules.length ?? 1) - 1, current + 1))}
                disabled={!schedule || current >= (result?.schedules.length ?? 0) - 1} aria-label="Next schedule">›</button>
            </div>
            {schedule && (
              <div className="facts">
                <span><b>{schedule.hours}</b> hours</span>
                <span><b>{schedule.metrics.daysOnCampus}</b> days on campus</span>
                <span><b>{schedule.metrics.gapHours}</b> h of gaps</span>
                {schedule.metrics.earliest !== null && <span>first class <b>{formatTime(schedule.metrics.earliest)}</b></span>}
                {schedule.metrics.avgGpaDelta !== null && (
                  <span>instructors <b>{schedule.metrics.avgGpaDelta >= 0 ? "+" : ""}{schedule.metrics.avgGpaDelta.toFixed(2)}</b> GPA vs course avg</span>
                )}
                {schedule.missingOptional.length > 0 && <span>left out: <b>{schedule.missingOptional.join(", ")}</b></span>}
              </div>
            )}
          </div>

          {replacing && (
            <div className="notice">
              Showing other times for <b>{replacing}</b> with the rest of your schedule kept as it was.{" "}
              <button className="secondary" style={{ padding: "2px 8px" }} onClick={() => { setReplacing(null); post({ kind: "solve", cart, courses, profile, prefs, gpa }); }}>
                Back to all schedules
              </button>
            </div>
          )}


          {result && !solving && result.schedules.length === 0 && cart.length > 0 && (
            <div className="notice bad" role="status">
              <b>No schedule fits everything.</b>
              <ul>
                {result.diagnoses.filter((d) => d.reason).map((d) => <li key={d.courseId}>{d.courseId}: {d.reason}</li>)}
                {result.clashes.map(([a, b]) => <li key={a + b}>{a} and {b} always overlap with your current settings. Make one optional, or allow closed sections.</li>)}
              </ul>
              {result.diagnoses.some((d) => d.reason?.includes("closed")) && !prefs.includeClosed && (
                <button className="primary" style={{ marginTop: 8 }} onClick={() => setPref("includeClosed", true)}>Include closed sections</button>
              )}
            </div>
          )}

          {cart.length === 0 ? (
            <div className="notice">
              Add the courses you want next semester. The planner finds every combination of lecture, discussion and lab sections that fits your week, and ranks them by your preferences.
              {plan.roadmap?.terms[0] && scheduleTerm && (
                <div style={{ marginTop: 10 }}>
                  <button className="primary" onClick={() => openInBuilder([...new Set(plan.roadmap!.terms[0].items.map((i) => i.id))], scheduleTerm)}>
                    Start from my recommended courses
                  </button>
                </div>
              )}
            </div>
          ) : (
            <WeekGrid schedule={schedule} colorOf={colorOf} busy={prefs.busy} selected={selected} onSelect={setSelected} />
          )}
          {result && ms !== null && (
            <p className="small" style={{ padding: "0 14px 12px", margin: 0 }}>
              Checked {result.searched.toLocaleString()} combinations in {ms} ms{result.truncated ? " (search capped; lock a section to narrow it)" : ""}.
            </p>
          )}
        </div>

        {/* ---------- right: course detail ---------- */}
        <div className="detail-col">
          <div className="panel">
            <div className="body" style={{ paddingTop: 14 }}>
              {selectedCourse ? (
                <CourseDetail
                  course={selectedCourse}
                  option={selectedOption}
                  gpa={gpa[selectedCourse.id]}
                  profile={profile}
                  pinned={pinnedSel}
                  onPin={togglePin}
                  onExclude={exclude}
                  onReplace={replace}
                  color={colorOf(selectedCourse.id)}
                />
              ) : (
                <p className="hint" style={{ margin: 0 }}>Select a course on the grid or in your list to see its sections, restrictions and how each professor grades.</p>
              )}
            </div>
          </div>
        </div>
      </main>
      <p className="disclaimer">
        Unofficial student project. Section data from Course Explorer {index ? `(fetched ${new Date(index.fetchedAt).toLocaleString()})` : ""}; seat status changes quickly, so confirm in Course Explorer before registering. Grade data from the UIUC GPA dataset through {index?.gpaThrough ?? "–"}.
      </p>
    </div>
  );
}
