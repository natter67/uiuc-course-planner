"use client";

import { useState } from "react";
import { parseAudit } from "@/lib/audit";
import { serializeAuditHtml } from "@/lib/auditDom";
import { looksLikeAudit } from "@/lib/auditImport";

const UACHIEVE = "https://uachieve.apps.uillinois.edu/uachieve_uiuc/audit/list.html";

interface Props {
  onImport: (text: string, example?: boolean) => void;
}

/** First screen: what the planner does, and the three ways to bring in an audit. */
export default function Welcome({ onImport }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);

  const importText = (text: string) => {
    if (!looksLikeAudit(text) || !parseAudit(text).requirements.length) {
      setError("That doesn't look like a whole uAchieve audit. Open your audit, click on it, press Cmd+A (Ctrl+A on Windows), copy, and paste here.");
      return;
    }
    setError(null);
    onImport(text);
  };

  const importFile = async (file: File) => {
    const raw = await file.text();
    importText(/<html|<div class="requirement/i.test(raw) ? serializeAuditHtml(raw) : raw);
  };

  const showExample = async () => {
    setLoadingExample(true);
    try {
      onImport(await fetch("/example-audit.txt").then((r) => r.text()), true);
    } finally {
      setLoadingExample(false);
    }
  };

  return (
    <div className="welcome">
      <section className="welcome-hero">
        <h1>Know what to take next semester, and why.</h1>
        <p>
          Bring in your degree audit and the planner works out what you still need, which courses keep you on track to
          graduate, and a week schedule that fits. Then pick electives and gen eds by GPA, professor and what counts twice.
        </p>
        <button className="secondary" onClick={showExample} disabled={loadingExample}>
          {loadingExample ? "Loading…" : "See an example first"}
        </button>
      </section>

      <section className="panel welcome-import">
        <h2>Bring in your audit (about 30 seconds)</h2>
        <div className="body">
          <ol className="steps">
            <li>Open <a href={UACHIEVE} target="_blank" rel="noreferrer">your audit in uAchieve</a> and sign in. Run a new audit if yours is old.</li>
            <li>Click anywhere on the audit, press <kbd>Cmd</kbd>+<kbd>A</kbd> then <kbd>Cmd</kbd>+<kbd>C</kbd> (Windows: <kbd>Ctrl</kbd>).</li>
            <li>Paste it here:</li>
          </ol>
          <textarea className="paste" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your whole audit here" aria-label="Audit text" rows={6} />
          {error && <p className="notice bad" role="alert" style={{ margin: "8px 0" }}>{error}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => importText(draft)} disabled={!draft.trim()}>Plan my next semester</button>
            <span className="small">Your audit stays in this browser and is never uploaded.</span>
          </div>
          <details className="small" style={{ marginTop: 12 }}>
            <summary>Other ways to import</summary>
            <p>
              Upload the audit page saved from your browser (File → Save Page As):{" "}
              <input type="file" accept=".html,.htm,.txt" aria-label="Upload saved audit page"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
            </p>
            <p style={{ marginBottom: 0 }}>Or install the browser extension: an &quot;Open in Illini Course Planner&quot; button appears on the audit page.</p>
          </details>
        </div>
      </section>
    </div>
  );
}
