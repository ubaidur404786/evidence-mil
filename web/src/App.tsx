import { useCallback, useEffect, useState } from "react";
import { pickSource, type Source } from "./api";
import { CaseWorkspace } from "./components/CaseWorkspace";
import { FlowRunner } from "./components/FlowRunner";
import { Compare, HowItWorks, RunLocally } from "./components/InfoPages";
import { UploadDialog } from "./components/UploadDialog";
import { Worklist, type CaseState } from "./components/Worklist";
import { deriveView } from "./lib/derive";
import type { CaseSummary, CaseView, PackInfo, StepEvent } from "./types";

export function App({ source: given, intervalMs }: { source?: Source; intervalMs?: number }) {
  const [source, setSource] = useState<Source | undefined>(given);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [states, setStates] = useState<Record<string, CaseState>>({});
  const [caseId, setCaseId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [view, setView] = useState<CaseView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState<"review" | "how" | "compare" | "local">("review");
  const [mode, setMode] = useState<"flow" | "workstation">("flow");
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!source) pickSource().then(setSource);
  }, [source]);

  useEffect(() => {
    if (!source) return;
    source.listCases().then(setCases).catch((e) => setError(String(e)));
    source.listPacks().then(setPacks).catch(() => setPacks([]));
  }, [source]);

  const open = useCallback(async (id: string) => {
    if (!source) return;
    setCaseId(id);
    setView(null);
    setError(undefined);
    setLoading(true);
    const collected: StepEvent[] = [];
    try {
      const rid = await source.run(id, (e) => collected.push(e));
      const v = deriveView(collected);
      if (!v) throw new Error("incomplete run: not all six steps arrived");
      setRunId(rid);
      setView(v);
      setStates((s) => ({ ...s, [id]: { probability: v.aggregate.probability, abstain: v.aggregate.abstain, status: v.report?.status } }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [source]);

  function uploaded(c: CaseSummary) {
    setUploading(false);
    setCases((cs) => [c, ...cs]);
    open(c.case_id);
  }

  const canUpload = Boolean(source?.live && source.upload && packs.some((p) => p.upload));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>◧</span>
          <div>
            <h1>EvidenceMIL</h1>
            <p>Explainable image review · see which patches decided the prediction</p>
          </div>
        </div>
        <nav className="nav" aria-label="sections">
          {([["review", "Review"], ["how", "How it works"], ["compare", "Compare methods"]] as const).map(([k, label]) => (
            <button key={k} className={page === k ? "is-on" : ""} onClick={() => setPage(k)}>{label}</button>
          ))}
        </nav>
        <div className="topbar__right">
          {source && <span className={`chip ${source.live ? "chip--live" : ""}`}>{source.live ? "Live API" : "Replay · recorded runs"}</span>}
          {canUpload
            ? <button onClick={() => setUploading(true)} data-testid="upload-open">⇪ Upload image</button>
            : source && <button onClick={() => setPage("local")} data-testid="upload-guide">⇪ Upload image</button>}
        </div>
      </header>

      {page !== "review" && (
        <div className="pagescroll">
          {page === "how" && <HowItWorks />}
          {page === "compare" && <Compare />}
          {page === "local" && <RunLocally />}
        </div>
      )}
      <div className={`layout${focus ? " is-focus" : ""}`} hidden={page !== "review"}>
        <Worklist cases={cases} states={states} current={caseId} onOpen={open} />
        <main className="main">
          {error && <p className="banner bad">{error}</p>}
          {!caseId && !error && (
            <div className="empty">
              <h2>Select a case from the worklist</h2>
              <p className="muted">The pipeline replays step by step: tiling, encoding, the additive model's score, the exact
                patch contributions behind it, and a verified report for sign-off.</p>
              {!source?.live && <p className="muted small">Public demo: recorded runs. Run the API locally for live analysis and uploads.</p>}
            </div>
          )}
          {loading && <div className="processing" data-testid="loading"><span className="processing__ring" aria-hidden /><span>Running the model on this case… (first live run loads the encoder)</span></div>}
          {view && runId && (
            <div className="modebar" role="tablist" aria-label="view">
              <button role="tab" aria-selected={mode === "flow"} className={mode === "flow" ? "is-on" : ""} onClick={() => setMode("flow")}>Pipeline flow</button>
              <button role="tab" aria-selected={mode === "workstation"} className={mode === "workstation" ? "is-on" : ""} onClick={() => setMode("workstation")}>Review workstation</button>
              <button className={focus ? "is-on" : ""} onClick={() => setFocus((f) => !f)} title="Hide the worklist">{focus ? "⇥ Show worklist" : "⇤ Focus"}</button>
            </div>
          )}
          {view && runId && mode === "flow" && (
            <FlowRunner
              key={`flow-${runId}`}
              view={view}
              processMs={intervalMs != null ? intervalMs / 2 : undefined}
              dwellMs={intervalMs}
              patchUrl={(pid) => source!.patchUrl(view.caseId, pid)}
              onDecide={source?.live ? (a, s) => source.decide(runId, a, s) : undefined}
              onStatus={(status) => setStates((s) => ({ ...s, [view.caseId]: { ...s[view.caseId], status } }))}
              onWorkstation={() => setMode("workstation")}
            />
          )}
          {view && runId && mode === "workstation" && (
            <CaseWorkspace
              key={runId}
              view={view}
              intervalMs={intervalMs}
              patchUrl={(pid) => source!.patchUrl(view.caseId, pid)}
              onDecide={source?.live ? (a, s) => source.decide(runId, a, s) : undefined}
              onStatus={(status) => setStates((s) => ({ ...s, [view.caseId]: { ...s[view.caseId], status } }))}
            />
          )}
        </main>
      </div>
      <footer className="footer">Decision support for demonstration, not a medical device. Cached cases are labelled as such.</footer>
      {uploading && source?.upload && (
        <UploadDialog packs={packs} onUpload={source.upload} onDone={uploaded} onClose={() => setUploading(false)} />
      )}
    </div>
  );
}
