import { useMemo, useState } from "react";
import { pct } from "../lib/derive";
import type { CaseSummary } from "../types";

export interface CaseState {
  probability?: number;
  abstain?: boolean;
  status?: string; // report status
}

const FILTERS = ["all", "to review", "signed off", "abstained"] as const;

function bucket(s?: CaseState): (typeof FILTERS)[number] {
  if (!s?.status) return "to review";
  if (s.status === "abstained") return "abstained";
  if (s.status === "approved" || s.status === "edited") return "signed off";
  return "to review";
}

export function Worklist({ cases, states, current, onOpen, onHide }: {
  cases: CaseSummary[];
  states: Record<string, CaseState>;
  current?: string;
  onOpen: (id: string) => void;
  onHide?: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () =>
      cases.filter(
        (c) =>
          (filter === "all" || bucket(states[c.case_id]) === filter) &&
          `${c.case_id} ${c.title} ${c.domain}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [cases, states, filter, query],
  );
  const groups = useMemo(() => {
    const g = new Map<string, CaseSummary[]>();
    shown.forEach((c) => g.set(c.domain || c.pack || "cases", [...(g.get(c.domain || c.pack || "cases") ?? []), c]));
    return [...g.entries()];
  }, [shown]);

  return (
    <aside className="worklist" aria-label="worklist">
      <div className="worklist__head">
        <h2>Worklist</h2>
        <span className="muted small">{cases.length} cases</span>
        {onHide && <button className="icon worklist__hide" onClick={onHide} aria-label="hide worklist" title="Hide the worklist">«</button>}
      </div>
      <input className="search" placeholder="Search cases" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {groups.map(([group, items]) => (
        <div key={group} className="worklist__group">
          <h3>{group}</h3>
          <ul>
            {items.map((c) => {
              const s = states[c.case_id];
              return (
                <li key={c.case_id}>
                  <button className={`case${c.case_id === current ? " is-current" : ""}`} onClick={() => onOpen(c.case_id)}>
                    <span className="case__id">{c.case_id}{c.uploaded && <span className="chip chip--up">upload</span>}</span>
                    <span className="case__title">{c.title}</span>
                    <span className="case__meta">
                      {s?.probability != null ? (
                        <>
                          <span className="meter"><span style={{ width: pct(s.probability) }} className={s.abstain ? "warn" : s.probability >= 0.5 ? "pos" : "neg"} /></span>
                          <span className="num">{pct(s.probability, 0)}</span>
                        </>
                      ) : (
                        <span className="muted small">not run</span>
                      )}
                      {s?.status && <span className={`chip chip--${s.status}`}>{s.status}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
