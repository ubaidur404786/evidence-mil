import { useEffect, useState } from "react";
import type { Report, StepEvent } from "../types";

interface Props {
  events: StepEvent[];
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
}

export function ReportStep({ events, onDecide }: Props) {
  const initial = (events.find((e) => e.step === "report")?.payload as { report?: Report })?.report;
  const [report, setReport] = useState<Report | undefined>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Report["sections"]>(initial?.sections ?? []);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReport(initial);
    setDraft(initial?.sections ?? []);
  }, [initial]);

  if (!report) return <p className="hint">No report.</p>;

  async function decide(action: "approve" | "edit") {
    setError(undefined);
    try {
      const next = onDecide ? await onDecide(action, action === "edit" ? draft : undefined) : undefined;
      if (next) setReport(next);
      else setReport({ ...report!, status: action === "edit" ? "edited" : "approved", sections: action === "edit" ? draft : report!.sections });
      setEditing(false);
    } catch (e) {
      // Replay mode or API error: record locally, say so.
      setReport({ ...report!, status: action === "edit" ? "edited" : "approved", sections: action === "edit" ? draft : report!.sections });
      setEditing(false);
      setError(String((e as Error).message));
    }
  }

  const v = report.verifier;
  const canDecide = report.status === "draft";
  return (
    <div className="report" data-testid="report">
      <div className="report__head">
        <span className={`badge badge--${report.status}`} data-testid="report-status">
          {report.status}
        </span>
        <span className={v.passed ? "ok" : "bad"} data-testid="verifier">
          {v.passed ? "✓ every number and patch id checked against the evidence" : "✗ verifier found problems"}
        </span>
      </div>
      {!v.passed && (
        <ul className="errors">
          {v.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {(editing ? draft : report.sections).map((s, i) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          {editing ? (
            <textarea
              aria-label={`edit ${s.title}`}
              value={s.text}
              onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, text: e.target.value } : d)))}
            />
          ) : (
            <p>{s.text}</p>
          )}
          {s.citations.length > 0 && (
            <div className="cites">
              {s.citations.map((c) => (
                <span key={c} className="cite">patch {c}</span>
              ))}
            </div>
          )}
        </section>
      ))}
      {canDecide && (
        <div className="actions">
          {editing ? (
            <>
              <button onClick={() => decide("edit")}>Save edit</button>
              <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => decide("approve")} data-testid="approve">Approve</button>
              <button className="ghost" onClick={() => setEditing(true)}>Edit</button>
            </>
          )}
        </div>
      )}
      {error && <p className="hint">Saved locally only: {error}</p>}
      <p className="disclaimer">Decision-support demo, not a medical device.</p>
    </div>
  );
}
