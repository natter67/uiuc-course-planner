"use client";

import { formatTime } from "@/lib/normalize";
import type { BusyBlock, Schedule } from "@/lib/solver";
import { DAYS, type Day } from "@/lib/types";

const DAY_NAMES: Record<Day, string> = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri" };

interface Props {
  schedule: Schedule | null;
  colorOf: (courseId: string) => string;
  busy: BusyBlock[];
  selected: string | null;
  onSelect: (courseId: string) => void;
}

export default function WeekGrid({ schedule, colorOf, busy, selected, onSelect }: Props) {
  type Item = {
    key: string; courseId: string | null; day: Day; start: number; end: number;
    label: string; meta: string; status: string; part: "1" | "A" | "B";
  };
  const items: Item[] = [];
  const online: { courseId: string; text: string }[] = [];

  for (const o of schedule?.options ?? [])
    for (const s of o.sections)
      for (const [mi, m] of s.meetings.entries()) {
        if (m.start === null || m.end === null || !m.days.length) {
          online.push({ courseId: o.courseId, text: `${o.courseId} ${s.code} (${m.typeName.toLowerCase()})` });
          continue;
        }
        for (const d of m.days)
          items.push({
            key: `${s.crn}-${mi}-${d}`, courseId: o.courseId, day: d, start: m.start, end: m.end,
            label: `${o.courseId} ${s.code}`,
            meta: `${formatTime(m.start)} · ${m.location || m.typeName}`,
            status: s.status, part: s.partOfTerm,
          });
      }
  for (const [i, b] of busy.entries())
    for (const d of b.days)
      items.push({ key: `busy-${i}-${d}`, courseId: null, day: d, start: b.start, end: b.end, label: b.label, meta: `${formatTime(b.start)}–${formatTime(b.end)}`, status: "busy", part: "1" });

  const first = Math.min(8 * 60, ...items.map((x) => x.start));
  const last = Math.max(17 * 60, ...items.map((x) => x.end));
  const startHour = Math.floor(first / 60);
  const endHour = Math.ceil(last / 60);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const px = (min: number) => `calc(${(min - startHour * 60) / 60} * var(--hour))`;
  const height = `calc(${endHour - startHour} * var(--hour))`;

  return (
    <div className="grid-wrap">
      <div className="week" role="grid" aria-label="Weekly schedule">
        <div className="dayhead" aria-hidden />
        {DAYS.map((d) => (
          <div className="dayhead" key={d} role="columnheader">{DAY_NAMES[d]}</div>
        ))}
        <div className="hours" style={{ height }} aria-hidden>
          {hours.map((h) => (
            <span key={h} style={{ top: px(h * 60) }}>{h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}</span>
          ))}
        </div>
        {DAYS.map((d) => (
          <div className="col" key={d} style={{ height }} role="gridcell">
            {hours.map((h) => <div className="hline" key={h} style={{ top: px(h * 60) }} />)}
            {items.filter((x) => x.day === d).map((x) => {
              const cls = ["block", x.status, x.part !== "1" ? `half ${x.part === "B" ? "b" : "a"}` : "", x.courseId && x.courseId === selected ? "selected" : ""].join(" ");
              const style = { top: px(x.start), height: `calc(${(x.end - x.start) / 60} * var(--hour) - 2px)`, ["--c" as string]: x.courseId ? colorOf(x.courseId) : undefined };
              const halfNote = x.part === "A" ? ", first 8 weeks" : x.part === "B" ? ", second 8 weeks" : "";
              return x.courseId ? (
                <button key={x.key} className={cls} style={style} onClick={() => onSelect(x.courseId!)}
                  aria-label={`${x.label}, ${DAY_NAMES[x.day]} ${x.meta}, ${x.status}${halfNote}`}>
                  <b>{x.label}</b>
                  <span className="meta">{x.meta}</span>
                </button>
              ) : (
                <div key={x.key} className={cls} style={style}><b>{x.label}</b><span className="meta">{x.meta}</span></div>
              );
            })}
          </div>
        ))}
      </div>
      {online.length > 0 && (
        <div className="online">
          Online or arranged, not on the grid: {online.map((o, i) => (
            <span key={i}>{i ? ", " : ""}<button className="name" style={{ background: "none", border: 0, padding: 0, color: "var(--action)", cursor: "pointer" }} onClick={() => onSelect(o.courseId)}>{o.text}</button></span>
          ))}
        </div>
      )}
      <div className="legend">
        <span><i />Open</span>
        <span><i className="restricted" />Open (restricted)</span>
        <span><i className="closed" />Closed</span>
        <span>Half-width blocks run for 8 weeks</span>
      </div>
    </div>
  );
}
