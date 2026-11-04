import { useEffect, useState } from "react";
import type { Report } from "../types";

interface Props {
  report: Report | null;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
  onCite?: (patchId: number) => void;
  onStatus?: (status: Report["status"]) => void;
}

/** Agent draft → verifier result → human approve / edit. The LLM never makes the prediction. */
export function ReportPanel({ report: initial, onDecide, onCite, onStatus }: Props) {
  const [report, setReport] = useState<Report | null>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Report["sections"]>(initial?.sections ?? []);
  const [note, setNote] = useState<string>();

  useEffect(() => {
    setReport(initial);
    setDraft(initial?.sections ?? []);
    setEditing(false);
    setNote(undefined);
  }, [initial]);

  if (!report) return <p className="muted pad">No report for this run.</p>;

  async function decide(action: "approve" | "edit") {
    const local: Report = { ...report!, status: action === "edit" ? "edited" : "approved", sections: action === "edit" ? draft : report!.sections };
    setNote(undefined);
    try {
      const next = onDecide ? await onDecide(action, action === "edit" ? draft : undefined) : local;
      setReport(next);
      onStatus?.(next.status);
      if (next.status === "draft" && !next.verifier.passed) {
        setNote("The verifier rejected the edit: fix the listed problems.");
        return;
      }
    } catch (e) {
      setReport(local);
      onStatus?.(local.status);
      setNote(`Saved in this browser only: ${(e as Error).message}`);
    }
    setEditing(false);
  }

  const v = report.verifier;
  return (
    <div className="report" data-testid="report">
      <div className="report__head">
        <span className={`chip chip--${report.status}`} data-testid="report-status">{report.status}</span>
        <span className={v.passed ? "ok" : "bad"} data-testid="verifier">
          {v.passed ? "✓ every number and patch id checked against the evidence" : "✗ verifier found problems"}
        </span>
      </div>
      {!v.passed && (
        <ul className="errors">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {(editing ? draft : report.sections).map((s, i) => (
        <section key={s.title} className="report__section">
          <h4>{s.title}</h4>
          {editing ? (
            <textarea aria-label={`edit ${s.title}`} value={s.text}
              onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, text: e.target.value } : d)))} />
          ) : (
            <p>{s.text}</p>
          )}
          {s.citations.length > 0 && (
            <div className="cites">
              {s.citations.map((c) => (
                <button key={c} className="cite" onClick={() => onCite?.(c)}>patch {c}</button>
              ))}
            </div>
          )}
        </section>
      ))}
      {report.status === "draft" && (
        <div className="actions">
          {editing ? (
            <>
              <button onClick={() => decide("edit")}>Save edit</button>
              <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => decide("approve")} data-testid="approve">Approve report</button>
              <button className="ghost" onClick={() => setEditing(true)}>Edit</button>
            </>
          )}
        </div>
      )}
      {note && <p className="muted small">{note}</p>}
      <p className="disclaimer">Decision support for demonstration, not a medical device.</p>
    </div>
  );
}
