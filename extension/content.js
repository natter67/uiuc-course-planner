"use strict";
(() => {
  // src/lib/auditDom.ts
  var STATUS = { Status_OK: "Complete", Status_NO: "Unfulfilled", Status_IP: "In Progress", statusOK: "Complete", statusNO: "Unfulfilled", statusIP: "In Progress" };
  function clean(s) {
    return (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }
  function lines(el) {
    if (!el) return [];
    const out = [""];
    const walk = (n) => {
      if (n.nodeType === 3) out[out.length - 1] += n.textContent ?? "";
      else if (n.nodeType === 1) {
        const e = n;
        if (e.tagName === "BR") out.push("");
        else if (!e.classList.contains("sr-only")) e.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return out.map(clean).filter(Boolean);
  }
  function statusWord(el) {
    if (!el) return "";
    for (const c of Array.from(el.classList)) if (STATUS[c]) return STATUS[c];
    const sr = clean(el.querySelector(".sr-only")?.textContent);
    const m = /(Complete|Unfulfilled|In Progress)/.exec(sr);
    return m ? m[1] : "";
  }
  function totals(table) {
    if (!table) return [];
    const out = [];
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      const label = clean(tr.querySelector(".rowlabel")?.textContent);
      if (!/^(NEEDS|EARNED):?$/.test(label)) continue;
      const pairs = [
        [clean(tr.querySelector(".hours.number, td.hours")?.textContent), clean(tr.querySelector(".hourslabel")?.textContent)],
        [clean(tr.querySelector(".count.number, td.count")?.textContent), clean(tr.querySelector(".countlabel")?.textContent)],
        [clean(tr.querySelector(".subreqs.number")?.textContent), clean(tr.querySelector(".subreqslabel")?.textContent)]
      ];
      for (const [v, unit] of pairs) if (v && unit) out.push(`${label.replace(/:?$/, ":")}	${v} ${unit}`);
    }
    return out;
  }
  function courseRows(scope) {
    const out = [];
    for (const tr of Array.from(scope.querySelectorAll(":scope > table.completedCourses tr.takenCourse, :scope > .completedCourses tr.takenCourse"))) {
      const cell = (c) => clean(tr.querySelector(`td.${c}`)?.textContent);
      out.push([cell("term"), cell("course"), cell("credit"), cell("grade"), cell("ccode")].join("	") + "	");
      for (const d of Array.from(tr.querySelectorAll("td.description .descLine"))) out.push(clean(d.textContent));
    }
    return out;
  }
  function courseList(table) {
    if (!table) return "";
    return clean(table.querySelector(".fromcourselist")?.textContent);
  }
  function serializeAuditDocument(doc) {
    const out = [];
    const titleLines = lines(doc.querySelector(".auditTitle")).filter((l) => !/Request Audit/i.test(l));
    const program = titleLines[titleLines.length - 1] ?? "";
    const facts = {};
    for (const th of Array.from(doc.querySelectorAll(".auditHeaderTable th"))) facts[clean(th.textContent)] = clean(th.nextElementSibling?.textContent);
    out.push(program);
    out.push(`Prepared On	${facts["Prepared On"] ?? ""}	Program Code	${facts["Program Code"] ?? ""}	Catalog Year	${facts["Catalog Year"] ?? ""}`);
    for (const req of Array.from(doc.querySelectorAll("div.requirement"))) {
      const titleL = lines(req.querySelector(".reqTitle"));
      const title = titleL[0] ?? clean(req.querySelector("h3")?.textContent).replace(/^Requirement:\s*/, "");
      const status = statusWord(req.querySelector(".reqStatusGroup .status")) || statusWord(req);
      out.push(`Requirement: ${title}	Requirement${status ? " " + status : ""}	${title}`);
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
        const hasStatusMarker = !!sub.querySelector(".subreqPretext .status .sr-only");
        if (subStatus || num || sl.length || hasStatusMarker) out.push(`  Sub-Requirement${subStatus ? " " + subStatus : ""}${num ? " " + num : ""}	${sl[0] ?? ""}`);
        out.push(...sl.slice(1));
        const sbody = sub.querySelector(".subreqBody") ?? sub;
        out.push(...totals(sbody.querySelector(":scope > table.subreqNeeds")).map((l) => l.replace(" ", "	")));
        for (const t of Array.from(sbody.querySelectorAll(":scope > table.subreqNeeds"))) {
          const cells = Array.from(t.querySelectorAll("td")).map((td) => clean(td.textContent)).filter(Boolean);
          if (cells[0] === "NEEDS:" && cells.length >= 3) out.push(`NEEDS:	${cells[1]}	${cells[2]}`);
        }
        out.push(...courseRows(sbody));
        const not = courseList(sbody.querySelector(":scope > table.notcourses"));
        if (not) out.push(`-- NOT FROM:	${not}`);
        const sel = courseList(sbody.querySelector(":scope > table.selectcourses"));
        if (sel) out.push(`SELECT FROM:	${sel}`);
      }
    }
    return out.filter((l) => l !== void 0).join("\n");
  }

  // src/lib/auditImport.ts
  function toBase64Url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function pipe(bytes, stream) {
    const input = new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      }
    });
    const out = input.pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function encodeAudit(text) {
    return toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));
  }

  // extension/src/content.ts
  var DEFAULT_PLANNER = "http://localhost:3000";
  var plannerUrl = DEFAULT_PLANNER;
  chrome.storage.sync.get({ plannerUrl: DEFAULT_PLANNER }).then((v) => plannerUrl = v.plannerUrl || DEFAULT_PLANNER);
  var isAuditPage = () => !!document.querySelector("div.requirement .reqTitle");
  async function send(button) {
    const tab = window.open("about:blank", "_blank");
    button.disabled = true;
    button.textContent = "Opening planner\u2026";
    try {
      const payload = await encodeAudit(serializeAuditDocument(document));
      const url = `${plannerUrl.replace(/\/+$/, "")}/#audit=${payload}`;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
      button.textContent = "Sent to planner";
    } catch (e) {
      tab?.close();
      button.textContent = "Couldn't send. Copy the audit instead.";
      console.error("[Illini Course Planner]", e);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Open in Illini Course Planner";
      }, 4e3);
    }
  }
  function addButton() {
    if (!isAuditPage() || document.getElementById("icp-send")) return;
    const button = document.createElement("button");
    button.id = "icp-send";
    button.type = "button";
    button.textContent = "Open in Illini Course Planner";
    button.addEventListener("click", () => send(button));
    document.body.appendChild(button);
  }
  addButton();
  new MutationObserver(addButton).observe(document.body, { childList: true });
})();
