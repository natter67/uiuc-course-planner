# Illini Course Planner

A course planner for UIUC students. It opens on **Next semester**: after you bring in your audit
(or tap "See an example"), it shows the courses to take next term, why each one matters ("needed
for MSE 406, which only runs in fall"), and a week schedule that fits. When next term's sections
aren't published yet, it schedules with the same semester's times from last year and says so.

The other two tabs:

- **My degree.** Import your uAchieve degree audit (paste it, upload the saved page, or use the
  browser extension). The planner sees what you've taken and what's left, lists the courses that
  can fill each remaining requirement (with prerequisites checked against your record, GPA, and
  which ones count for two requirements at once), and lays out a semester-by-semester plan to
  graduation. Works for any major or minor, because the audit itself says what counts.
- **Schedule builder.** Add the courses you want next semester and it finds every conflict-free
  combination of lecture, discussion and lab sections, ranked by fewer gaps, days off, later
  mornings, or instructors who grade more generously. Each course shows seat status, restrictions,
  and a professor comparison from the UIUC GPA dataset.

Unofficial student project. Not affiliated with the University of Illinois.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests (solver, restrictions, crawler parsing)
```

The repo ships with prebuilt data in `public/data/`, so the app runs without crawling.

## Importing an audit

| Way | How |
| --- | --- |
| Paste | Open the audit in uAchieve, Cmd+A, Cmd+C, paste into **My degree** |
| Upload | Save the audit page (File → Save Page As) and upload it |
| Extension | Load `extension/` in Chrome (see `extension/README.md`); a button appears on the audit page |

The audit stays in the browser (localStorage). The extension passes it in the link's `#fragment`,
which is never sent to a server. The extension reads the page's markup, not your name or ID.

### How planning works

- `src/lib/audit.ts` parses the audit: requirement status, courses taken, `NEEDS:` and the
  `SELECT FROM` / `NOT FROM` course rules (ranges like `ABE 200 TO 496`, wildcards like `***** 297`).
- `src/lib/supplements.ts` adds course lists the audit leaves out (MatSE Topical Lectures, from the
  Academic Catalog). Add a block when another major needs one.
- `src/lib/prereqs.ts` reads Course Explorer's prerequisite sentences ("MSE 206; credit or
  concurrent registration in MSE 201 and MSE 401") into rules and checks them.
- `src/lib/plan.ts` lists candidates per need and builds the roadmap: required named courses first
  (they're the prerequisite chain that sets your graduation date), then electives, preferring
  courses that fill two needs; schedules a missing prerequisite (ECON 102 before FIN 221); skips
  courses restricted to other majors; ignores class-standing limits in future terms; respects the
  catalog caps (no more than 2 introductory topical lectures).
- Seasons come from when each course ran in the GPA data's last four years plus the loaded terms.

## Data

| Source | What we use | How |
| --- | --- | --- |
| [Course Explorer XML API](https://courses.illinois.edu/cisdocs/explorer) | Courses, sections, meeting times, instructors, gen eds, restrictions, linked-section notes | One `?mode=cascade` request per subject |
| Course Explorer course pages | Seat status (Open, Closed, Open (Restricted), Pending); the XML API doesn't include it | One HTML request per course, only for the subjects in `scripts/crawl.config.json` plus gen ed courses |
| [UIUC GPA dataset](https://github.com/wadefagen/datasets/tree/main/gpa) by Wade Fagen-Ulmschneider | Average GPA and % A by course and by instructor, last 5 years | `npm run data:gpa` downloads the CSV |
| Rate My Professors | Link-out per instructor for now | School id lives in `src/lib/data.ts` (`RMP_SCHOOL_ID`); verify it |

Refresh everything:

```bash
npm run data:gpa                         # GPA CSV (8.5 MB, not committed)
npm run data:crawl                       # newest published term -> data/raw/<term>.json
npm run data:crawl -- 2027-spring        # or a specific term
npm run data:build -- data/raw/2027-spring.json --catalog data/raw/2026-fall-catalog.json
```

The crawler also writes `<other season>-catalog.json` (titles, hours, gen eds, prerequisites from the
latest term of the other season) so courses not offered in the main term can still be planned.

`.github/workflows/crawl.yml` does this every 6 hours and commits `public/data/` when it changes.
Run it by hand from the Actions tab (it accepts a term). The crawler waits 250 ms between requests
with 3 at a time; keep it polite.

`data/raw/2026-fall-sample.json` is a 31-course sample collected by hand before the crawler existed.
It lacks course-level restriction notes; a real crawl replaces it.

## How it works

```
src/lib/
  types.ts          Course / Section / Meeting model
  normalize.ts      raw crawl format -> model; section groups; first-letter linking
  restrictions.ts   reads "Restricted to ..." / "Not intended for ..." text against a student profile
  gpa.ts            GPA aggregation, instructor name matching ("Holder, G" = "Holder, Gerald W")
  solver.ts         builds per-course options, searches conflict-free schedules, ranks them
  solver.worker.ts  runs the solver off the main thread
scripts/
  crawl.ts          Course Explorer crawler
  build-data.ts     writes public/data/<term>/{index.json, subjects/*.json, gpa/*.json}
src/components/     Planner (page state), WeekGrid, CourseDetail (sections + professor table)
```

### Rules the solver follows

- **One section per component.** Section types are grouped into lecture (LEC, LCD, OLC, ONL),
  discussion (DIS, Q, OD) and lab (LAB, OLB, LBD); a course needs one from each group it offers.
- **Linked sections.** Where Course Explorer says "beginning with the same letter" (CHEM 102 AL1 +
  AQ*, MATH 241 AL1 + AD*), sections only combine with the same first letter. Detected from the
  section codes, so PHYS 212 (A1 / D2A / L1A) correctly isn't linked.
- **8-week courses.** First-half (A) and second-half (B) sections at the same time don't conflict.
- **Restrictions.** Sections restricted to other majors, not intended for your college, paired with
  a program section, or needing department approval are skipped unless you opt in. The original
  text is always shown, since this is a best guess.
- **Seat status.** Closed sections are skipped by default; "Include closed sections" plans around them.
- **Ranking.** Optional courses fitted, then weighted: instructor GPA vs. course average, hours of
  gaps, days on campus, classes before 10am, and restricted/pending sections.
- **Find another time.** Keeps every other course where it is and re-solves one course.

Each course's options are collapsed by meeting times (sections at identical times differ only by
TA), then a depth-first search with bitmask conflict checks explores up to 400,000 branches and keeps
the best 50 schedules. That takes about a second for a six-course semester with PHYS 214's 900+
combinations.

## Next

- Spring 2027 data as soon as Course Explorer publishes it (the crawler picks it up automatically)
- Rate My Professors numbers in the professor table
- Prerequisite graph view of the plan
- Swap an elective in the plan and re-plan around it; what-if for a different major
- Publish the extension to the Chrome Web Store
