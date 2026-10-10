// Runs the solver off the main thread so the page stays responsive.
import { findReplacement, solve, type CartItem, type Preferences, type Schedule } from "./solver";
import type { StudentProfile } from "./restrictions";
import type { Course, GpaIndex } from "./types";

export type SolveRequest =
  | { id: number; kind: "solve"; cart: CartItem[]; courses: Course[]; profile: StudentProfile; prefs: Preferences; gpa: GpaIndex }
  | { id: number; kind: "replace"; current: Schedule; courseId: string; cart: CartItem[]; courses: Course[]; profile: StudentProfile; prefs: Preferences; gpa: GpaIndex };

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const req = e.data;
  const catalog = new Map(req.courses.map((c) => [c.id, c]));
  const t = performance.now();
  const result =
    req.kind === "solve"
      ? solve(req.cart, catalog, req.profile, req.prefs, req.gpa)
      : findReplacement(req.current, req.courseId, req.cart, catalog, req.profile, req.prefs, req.gpa);
  (self as unknown as Worker).postMessage({ id: req.id, result, ms: Math.round(performance.now() - t) });
};
