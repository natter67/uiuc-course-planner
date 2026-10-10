// Reads a uAchieve audit page's HTML structure and writes it out in the same text format you get
// from selecting the page and copying it, which is what parseAudit() reads. Used by the browser
// extension (on the live page) and by the planner's "upload saved page" option.
//
// Reading the markup instead of the rendered text makes the import independent of styles,
// collapsed sections and screen size. The student's name and ID are deliberately not copied.

const STATUS: Record<string, string> = { Status_OK: "Complete", Status_NO: "Unfulfilled", Status_IP: "In Progress", statusOK: "Complete", statusNO: "Unfulfilled", statusIP: "In Progress" };

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Text of an element split on <br>, one entry per visual line. */
function lines(el: Element | null): string[] {
  if (!el) return [];
  const out: string[] = [""];
  const walk = (n: Node) => {
    if (n.nodeType === 3) out[out.length - 1] += n.textContent ?? "";
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.tagName === "BR") out.push("");
      else if (!e.classList.contains("sr-only")) e.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  return out.map(clean).filter(Boolean);
}

function statusWord(el: Element | null): string {
  if (!el) return "";
  for (const c of Array.from(el.classList)) if (STATUS[c]) return STATUS[c];
  const sr = clean(el.querySelector(".sr-only")?.textContent);
  const m = /(Complete|Unfulfilled|In Progress)/.exec(sr);
  return m ? m[1] : "";
}

/** "NEEDS:" / "EARNED:" rows of a totals table, one output line per quantity. */
function totals(table: Element | null): string[] {
  if (!table) return [];
  const out: string[] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const label = clean(tr.querySelector(".rowlabel")?.textContent);
    if (!/^(NEEDS|EARNED):?$/.test(label)) continue;
    const pairs: [string, string][] = [
      [clean(tr.querySelector(".hours.number, td.hours")?.textContent), clean(tr.querySelector(".hourslabel")?.textContent)],
      [clean(tr.querySelector(".count.number, td.count")?.textContent), clean(tr.querySelector(".countlabel")?.textContent)],
      [clean(tr.querySelector(".subreqs.number")?.textContent), clean(tr.querySelector(".subreqslabel")?.textContent)],
    ];
    for (const [v, unit] of pairs) if (v && unit) out.push(`${label.replace(/:?$/, ":")}\t${v} ${unit}`);
  }
  return out;
}

function courseRows(scope: Element): string[] {
  const out: string[] = [];
  for (const tr of Array.from(scope.querySelectorAll(":scope > table.completedCourses tr.takenCourse, :scope > .completedCourses tr.takenCourse"))) {
    const cell = (c: string) => clean(tr.querySelector(`td.${c}`)?.textContent);
    out.push([cell("term"), cell("course"), cell("credit"), cell("grade"), cell("ccode")].join("\t") + "\t");
    for (const d of Array.from(tr.querySelectorAll("td.description .descLine"))) out.push(clean(d.textContent));
  }
  return out;
}

function courseList(table: Element | null): string {
  if (!table) return "";
  return clean(table.querySelector(".fromcourselist")?.textContent);
}

export function serializeAuditDocument(doc: Document): string {
  const out: string[] = [];

  // Header: program and audit facts only (no name or student ID).
  const titleLines = lines(doc.querySelector(".auditTitle")).filter((l) => !/Request Audit/i.test(l));
  const program = titleLines[titleLines.length - 1] ?? "";
  const facts: Record<string, string> = {};
  for (const th of Array.from(doc.querySelectorAll(".auditHeaderTable th"))) facts[clean(th.textContent)] = clean(th.nextElementSibling?.textContent);
  out.push(program);
  out.push(`Prepared On\t${facts["Prepared On"] ?? ""}\tProgram Code\t${facts["Program Code"] ?? ""}\tCatalog Year\t${facts["Catalog Year"] ?? ""}`);

  for (const req of Array.from(doc.querySelectorAll("div.requirement"))) {
    const titleL = lines(req.querySelector(".reqTitle"));
    const title = titleL[0] ?? clean(req.querySelector("h3")?.textContent).replace(/^Requirement:\s*/, "");
    const status = statusWord(req.querySelector(".reqStatusGroup .status")) || statusWord(req);
    out.push(`Requirement: ${title}\tRequirement${status ? " " + status : ""}\t${title}`);
    out.push(...titleL.slice(1));
    const body = req.querySelector(".reqBody");
    if (!body) continue;
    out.push(...lines(body.querySelector(":scope > .reqText, :scope > .reqtext")));
    out.push(...totals(body.querySelector(":scope > table.requirementTotals")));
    out.push(...courseRows(body));

    for (const sub of Array.from(body.querySelectorAll(".subrequirement"))) {
      const subStatus = statusWord(sub.querySelector(".subreqPretext .status"));
      const num = clean(sub.querySelector(".subreqNumber")?.textContent);
      const sl = lines(sub.querySelector(".subreqTitle"));
      // A sub-requirement with no status, number or title is just a course list under the
      // requirement (the copied text shows no "Sub-Requirement" line for it either).
      const hasStatusMarker = !!sub.querySelector(".subreqPretext .status .sr-only");
      if (subStatus || num || sl.length || hasStatusMarker) out.push(`  Sub-Requirement${subStatus ? " " + subStatus : ""}${num ? " " + num : ""}\t${sl[0] ?? ""}`);
      out.push(...sl.slice(1));
      const sbody = sub.querySelector(".subreqBody") ?? sub;
      out.push(...totals(sbody.querySelector(":scope > table.subreqNeeds")).map((l) => l.replace(" ", "\t")));
      for (const t of Array.from(sbody.querySelectorAll(":scope > table.subreqNeeds"))) {
        // subreqNeeds rows put the label in .rowlabel and values in plain cells: "NEEDS: 6.0 HOURS"
        const cells = Array.from(t.querySelectorAll("td")).map((td) => clean(td.textContent)).filter(Boolean);
        if (cells[0] === "NEEDS:" && cells.length >= 3) out.push(`NEEDS:\t${cells[1]}\t${cells[2]}`);
      }
      out.push(...courseRows(sbody));
      const not = courseList(sbody.querySelector(":scope > table.notcourses"));
      if (not) out.push(`-- NOT FROM:\t${not}`);
      const sel = courseList(sbody.querySelector(":scope > table.selectcourses"));
      if (sel) out.push(`SELECT FROM:\t${sel}`);
    }
  }
  return out.filter((l) => l !== undefined).join("\n");
}

export function serializeAuditHtml(html: string): string {
  return serializeAuditDocument(new DOMParser().parseFromString(html, "text/html"));
}
