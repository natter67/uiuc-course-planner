"use client";

import { useMemo, useState } from "react";
import { GEN_ED_LABELS, rmpSearchUrl } from "@/lib/data";
import { instructorKey } from "@/lib/gpa";
import { formatTime } from "@/lib/normalize";
import { evaluateAccess, type StudentProfile } from "@/lib/restrictions";
import type { CourseOption } from "@/lib/solver";
import type { Course, CourseGpa } from "@/lib/types";

interface Props {
  course: Course;
  option: CourseOption | null;
  gpa: CourseGpa | undefined;
  profile: StudentProfile;
  pinned: boolean;
  onPin: () => void;
  onExclude: (crn: string) => void;
  onReplace: () => void;
  color: string;
}

type SortKey = "gpa" | "delta" | "pctA" | "students";

export default function CourseDetail({ course, option, gpa, profile, pinned, onPin, onExclude, onReplace, color }: Props) {
  const [sort, setSort] = useState<SortKey | "now">("now");

  // Instructors teaching lecture-type sections this term.
  const teachingNow = useMemo(() => {
    const m = new Map<string, { name: string; sections: string[] }>();
    for (const s of course.sections) {
      if (s.group !== "lecture" && course.sections.some((x) => x.group === "lecture")) continue;
      for (const name of new Set(s.meetings.flatMap((mt) => mt.instructors))) {
        const k = instructorKey(name);
        if (!m.has(k)) m.set(k, { name, sections: [] });
        m.get(k)!.sections.push(s.code);
      }
    }
    return m;
  }, [course]);

  const rows = useMemo(() => {
    const keys = new Set([...teachingNow.keys(), ...Object.keys(gpa?.instructors ?? {})]);
    const base = gpa?.course.gpa ?? null;
    const list = [...keys].map((k) => {
      const g = gpa?.instructors[k];
      const now = teachingNow.get(k);
      return {
        key: k,
        name: g?.name ?? now?.name ?? k,
        gpa: g?.gpa ?? null,
        delta: g && base !== null ? Math.round((g.gpa - base) * 100) / 100 : null,
        pctA: g?.pctA ?? null,
        students: g?.students ?? 0,
        lastTerm: g?.lastTerm ?? "",
        now: now?.sections ?? [],
      };
    });
    const val = (r: (typeof list)[number]) =>
      sort === "now" ? (r.now.length ? 1e6 : 0) + (r.gpa ?? 0) : (r[sort] ?? -Infinity);
    return list.sort((a, b) => val(b) - val(a));
  }, [teachingNow, gpa, sort]);

  const header = (key: SortKey, label: string) => (
    <th className="num">
      <button onClick={() => setSort(key)} aria-sort={sort === key ? "descending" : undefined}>{label}</button>
    </th>
  );

  return (
    <div className="detail">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3><span className="swatch" style={{ display: "inline-block", height: 14, width: 6, background: color, marginRight: 8, verticalAlign: 0 }} />{course.id}</h3>
          <div className="sub">{course.title} · {course.creditHours}</div>
        </div>
        {gpa && (
          <div style={{ textAlign: "right" }}>
            <b style={{ fontSize: 20 }}>{gpa.course.gpa.toFixed(2)}</b>
            <div className="small">avg GPA, {gpa.course.pctA}% A</div>
          </div>
        )}
      </div>
      {course.genEd.length > 0 && (
        <div className="tags">{course.genEd.map((g) => <span className="tag" key={g}>{GEN_ED_LABELS[g] ?? g}</span>)}</div>
      )}

      {option && (
        <section>
          <h4>Sections in this schedule</h4>
          <div className="picked">
            {option.sections.map((s) => {
              const a = evaluateAccess(s, profile);
              return (
                <div className="sec" key={s.crn}>
                  <div className="top">
                    <span><b>{s.code}</b> · CRN {s.crn} · {s.meetings[0]?.typeName}</span>
                    <span className={`status ${s.status}`}>{s.statusText || s.status}</span>
                  </div>
                  {s.meetings.map((m, i) => (
                    <div key={i}>
                      {m.days.join("") || "Online"} {m.start !== null ? `${formatTime(m.start)}–${formatTime(m.end)}` : "arranged"}
                      {m.location ? ` · ${m.location}` : ""}{m.instructors.length ? ` · ${m.instructors.join(", ")}` : ""}
                    </div>
                  ))}
                  {s.partOfTerm !== "1" && <div className="small">{s.partOfTerm === "A" ? "First" : "Second"} 8 weeks</div>}
                  {a.reasons.length > 0 && <ul className="reasons">{a.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                  <button className="secondary" style={{ marginTop: 6, fontSize: 12, padding: "2px 8px" }} onClick={() => onExclude(s.crn)}>
                    Don&apos;t use {s.code}
                  </button>
                </div>
              );
            })}
          </div>
          {option.sameTime.length > 0 && (
            <p className="small">{option.sameTime.length} other section combination{option.sameTime.length > 1 ? "s" : ""} meet at exactly these times.</p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="secondary" onClick={onPin} aria-pressed={pinned}>{pinned ? "Unlock these sections" : "Lock these sections"}</button>
            <button className="secondary" onClick={onReplace}>Find another time</button>
          </div>
        </section>
      )}

      <section>
        <h4>Professors for {course.id}</h4>
        {rows.length === 0 ? (
          <p className="hint">No instructor or grade history for this course yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="prof">
              <thead>
                <tr>
                  <th><button onClick={() => setSort("now")} aria-sort={sort === "now" ? "descending" : undefined}>Instructor</button></th>
                  {header("gpa", "GPA")}
                  {header("delta", "vs avg")}
                  {header("pctA", "% A")}
                  {header("students", "Students")}
                  <th>Ratings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.now.length ? "now" : ""}>
                    <td>
                      {r.name}
                      <div className="small">{r.now.length ? `Teaching ${r.now.join(", ")}` : r.lastTerm ? `Last taught ${r.lastTerm}` : ""}</div>
                    </td>
                    <td className={`num ${r.students < 50 ? "thin" : ""}`}>{r.gpa?.toFixed(2) ?? "–"}</td>
                    <td className={`num delta ${r.delta === null ? "" : r.delta >= 0 ? "up" : "down"}`}>
                      {r.delta === null ? "–" : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}`}
                    </td>
                    <td className="num">{r.pctA === null ? "–" : `${r.pctA}%`}</td>
                    <td className="num">{r.students || "–"}</td>
                    <td><a href={rmpSearchUrl(r.name)} target="_blank" rel="noreferrer">RMP</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small">
              Grades from the UIUC GPA dataset (last 5 years). Faded numbers rest on fewer than 50 students. Average GPA is not difficulty: smaller and self-selected classes grade higher.
            </p>
          </div>
        )}
      </section>

      {(course.scheduleNote || course.info) && (
        <section>
          <h4>Course notes</h4>
          {course.scheduleNote && <p className="small" style={{ marginTop: 0 }}>{course.scheduleNote}</p>}
          {course.info && <p className="small">{course.info}</p>}
        </section>
      )}
    </div>
  );
}
