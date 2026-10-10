"use client";
// Shared planning state: the parsed audit, per-requirement candidates for the next term, and the
// roadmap to graduation. Computed once in the page and passed to every tab.

import { useMemo } from "react";
import { parseAudit, type Audit } from "./audit";
import type { TermIndex } from "./data";
import { buildNeedPlans, buildRoadmap, currentTerm, nextTerm, termSeason, type NeedPlan, type Roadmap, type Season } from "./plan";
import type { StudentProfile } from "./restrictions";

export interface PlanState {
  audit: Audit | null;
  /** Next term to plan, e.g. "SP27". */
  target: string;
  /** Candidates per open requirement for the target term. */
  plans: NeedPlan[];
  roadmap: Roadmap | null;
}

export function usePlan(auditText: string | null, index: TermIndex | null, profile: StudentProfile, maxHours: number): PlanState {
  const audit = useMemo(() => {
    if (!auditText) return null;
    try {
      const a = parseAudit(auditText);
      return a.requirements.length ? a : null;
    } catch {
      return null;
    }
  }, [auditText]);

  const target = audit ? nextTerm(currentTerm(audit)) : "";
  const indexSeason: Season = index ? termSeason(index.term) : "fa";

  const plansFor = useMemo(() => {
    const cache = new Map<Season, NeedPlan[]>();
    return (s: Season) => {
      if (!audit || !index) return [];
      if (!cache.has(s)) cache.set(s, buildNeedPlans(audit, index.courses, s, indexSeason, profile));
      return cache.get(s)!;
    };
  }, [audit, index, indexSeason, profile]);

  const plans = useMemo(() => (target ? plansFor(termSeason(target)) : []), [plansFor, target]);
  const roadmap = useMemo(
    () => (audit && index ? buildRoadmap(audit, plansFor, { maxHours, terms: 10 }, index.courses) : null),
    [audit, index, plansFor, maxHours],
  );
  return { audit, target, plans, roadmap };
}
