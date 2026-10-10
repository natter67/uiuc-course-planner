// Course lists the audit leaves out. uAchieve prints "SELECT FROM" for most needs, but some
// (MatSE Topical Lectures) only say "NEEDS: 12.0 HOURS". These come from the Academic Catalog;
// add a block per program as more majors are covered.

export interface SupplementGroup {
  name: string;
  courses: string[];
  /** Hour / course caps for this group within the need. */
  maxHours?: number;
  maxCourses?: number;
}

export interface Supplement {
  program: RegExp; // matched against the audit's program name
  need: RegExp; // matched against the sub-requirement title
  source: string;
  groups: SupplementGroup[];
  notes: string[];
}

export const SUPPLEMENTS: Supplement[] = [
  {
    program: /Materials Science/i,
    need: /TOPICAL LECTURES/i,
    source: "https://catalog.illinois.edu/undergraduate/engineering/materials-science-engineering-bs/",
    notes: [
      "12 hours of topical lectures (non-Biomaterials areas).",
      "No more than 6 hours (2 courses) from the introductory list.",
      "Only one science course may count.",
    ],
    groups: [
      { name: "Introductory", maxHours: 6, maxCourses: 2, courses: ["MSE 420", "MSE 441", "MSE 450", "MSE 470", "ECE 340"] },
      {
        name: "All other areas",
        courses: [
          "MSE 403", "MSE 421", "MSE 422", "MSE 440", "MSE 443", "MSE 453", "MSE 455", "MSE 456", "MSE 457", "MSE 458",
          "MSE 460", "MSE 461", "MSE 464", "MSE 466", "MSE 480", "MSE 481", "MSE 485", "MSE 487", "MSE 488", "MSE 489",
          "ABE 482", "ABE 483", "CEE 401", "CEE 460", "CHBE 458", "ECE 441", "ECE 443", "ECE 444", "ECE 481", "ECE 487",
          "ECE 488", "ECE 495", "ES 470", "IE 431", "ME 431", "ME 472", "ME 487", "SE 412", "TAM 451", "TAM 456",
        ],
      },
      { name: "Science", maxCourses: 1, courses: ["CHEM 436", "CHEM 483", "PHYS 485", "PHYS 486", "PHYS 487"] },
    ],
  },
  {
    program: /Materials Science/i,
    need: /MATERIALS LABORATORIES/i,
    source: "https://catalog.illinois.edu/undergraduate/engineering/materials-science-engineering-bs/",
    notes: ["Each MSE 404 section is 1.5 hours; take 4 different sections for 6 hours."],
    groups: [],
  },
];

export function supplementFor(program: string, needTitle: string): Supplement | undefined {
  return SUPPLEMENTS.find((s) => s.program.test(program) && s.need.test(needTitle));
}
