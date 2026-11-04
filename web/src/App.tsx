import { useEffect, useState } from "react";
import { pickSource, type Source } from "./api";
import { StepPlayer } from "./components/StepPlayer";
import type { CaseSummary, StepEvent } from "./types";

export function App({ source: given }: { source?: Source }) {
  const [source, setSource] = useState<Source | undefined>(given);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!source) pickSource().then(setSource);
  }, [source]);

  useEffect(() => {
    source?.listCases().then(setCases).catch((e) => setError(String(e)));
  }, [source]);

  async function start(id: string) {
    if (!source) return;
    setCaseId(id);
    setEvents([]);
    setError(undefined);
    const collected: StepEvent[] = [];
    try {
      const rid = await source.run(id, (e) => collected.push(e));
      setRunId(rid);
      setEvents(collected);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app">
      <header>
        <h1>EvidenceMIL</h1>
        <p className="tagline">See why the model decided: every patch behind the prediction, step by step.</p>
        {source && <span className="badge">{source.live ? "live API" : "replay mode (recorded runs)"}</span>}
      </header>
      <main>
        <aside className="cases">
          <h2>Cases</h2>
          <ul>
            {cases.map((c) => (
              <li key={c.case_id}>
                <button className={c.case_id === caseId ? "is-current" : ""} onClick={() => start(c.case_id)}>
                  <strong>{c.case_id}</strong>
                  <span>{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="main">
          {error && <p className="bad">{error}</p>}
          {!caseId && <p className="hint">Choose a case to replay the pipeline.</p>}
          {events.length > 0 && (
            <StepPlayer
              key={runId}
              events={events}
              onDecide={source?.live && runId ? (a, s) => source.decide(runId, a, s) : undefined}
            />
          )}
        </section>
      </main>
      <footer>Decision-support demo, not a medical device. Demo cases use cached patch embeddings.</footer>
    </div>
  );
}
