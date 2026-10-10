// Decides whether a student can probably register for a section, from the free-text
// restrictions Course Explorer publishes (sectionCappArea, sectionNotes, co-requests,
// special approval). This is a best guess; the UI always shows the original text.

import type { Section } from "./types";

export type Standing = "Freshman" | "Sophomore" | "Junior" | "Senior";

export interface StudentProfile {
  college: string; // "Grainger Engineering"
  major: string; // "Materials Science and Engineering"
  majorAliases: string[]; // ["MatSE", "Materials Science"]
  standing: Standing;
  programs: string[]; // ["Honors", "James Scholar", "Merit", "LLC name"]
  includeApprovalRequired: boolean;
}

export const DEFAULT_PROFILE: StudentProfile = {
  college: "Grainger Engineering",
  major: "Materials Science and Engineering",
  majorAliases: ["Materials Science", "Materials Sci", "MatSE"],
  standing: "Junior",
  programs: [],
  includeApprovalRequired: false,
};

export type Access = "ok" | "warn" | "blocked";
export interface AccessResult {
  access: Access;
  reasons: string[];
}

function terms(p: StudentProfile): string[] {
  const t = [p.college, p.major, ...p.majorAliases, ...p.programs, p.standing];
  if (/engineering/i.test(p.college)) t.push("Engineering");
  if (p.standing === "Freshman") t.push("First Time Freshman", "Freshman");
  return t.filter(Boolean).map((x) => x.toLowerCase());
}

function mentions(sentence: string, ts: string[]): boolean {
  const s = sentence.toLowerCase();
  return ts.some((t) => s.includes(t));
}

export function evaluateAccess(section: Section, profile: StudentProfile): AccessResult {
  const ts = terms(profile);
  const reasons: string[] = [];
  let access: Access = "ok";
  const block = (r: string) => {
    access = "blocked";
    reasons.push(r);
  };

  for (const r of section.restrictions) {
    const lower = r.toLowerCase();
    if (lower.startsWith("not intended for")) {
      if (mentions(r, ts)) block(r);
    } else if (lower.startsWith("restricted to")) {
      if (!mentions(r, ts)) block(r);
    }
  }
  if (section.coRequest) block(`Paired section: ${section.coRequest}`);
  if (section.specialApproval && !profile.includeApprovalRequired) block(section.specialApproval);

  if (access === "ok" && section.status === "restricted") {
    access = "warn";
    reasons.push("Course Explorer marks this section Open (Restricted); check the restriction text.");
  }
  return { access, reasons };
}
