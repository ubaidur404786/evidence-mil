import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pct, signed, verdict } from "../lib/derive";
import type { CaseView, Report } from "../types";
import { reducedMotion, useClock } from "./flow/anim";
import { RailFlow, type SegState } from "./flow/RailFlow";
import {
  AggregateStage, Crop, EncodeStage, ExplainStage, InputStage, ReportStage, ScoreStage, TileStage,
} from "./flow/stages";

/**
 * The forward pass as a left-to-right pipeline. Each stage computes (console), zooms out of its node into the
 * stage theatre and plays its own animation, then shrinks back into its node; the "+" on a node re-opens it.
 */
const STAGES = [
  { key: "input", title: "Input", sub: "whole-slide image", step: 0 },
  { key: "tile", title: "Patches", sub: "tile + drop background", step: 1 },
  { key: "encode", title: "Embeddings", sub: "frozen encoder", step: 2 },
  { key: "score", title: "Patch scores", sub: "one per instance", step: 3 },
  { key: "aggregate", title: "Slide score", sub: "Σ + calibrate", step: 3 },
  { key: "explain", title: "Explanation", sub: "where & why", step: 4 },
  { key: "report", title: "Report", sub: "verify + sign-off", step: 5 },
] as const;
type Stage = (typeof STAGES)[number]["key"];

const EXPLAIN: Record<Stage, string> = {
  input: "The specimen. Too large for one model pass, so the pipeline splits it.",
  tile: "Background is dropped; every tissue patch becomes one instance in the bag.",
  encode: "A frozen pathology model turns each patch into 768 numbers. Similar tissue lands together.",
  score: "The additive head scores every patch. Each score is its exact share of the slide decision.",
  aggregate: "Slide logit = Σ patch scores + bias, calibrated into a probability, with an abstain band.",
  explain: "The heatmap is the score itself, mapped back onto the slide, and checked by deletion.",
  report: "A draft report is verified against the evidence; a person signs off.",
};

const ZOOM_OUT_MS = 480;

interface Props {
  view: CaseView;
  processMs?: number; // compute console per stage
  dwellMs?: number; // auto mode: time each stage stays open
  patchUrl: (pid: number) => string | null;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
  onStatus?: (status: Report["status"]) => void;
  onWorkstation?: () => void;
}

export function FlowRunner({ view, processMs = 2200, dwellMs = 9000, patchUrl, onDecide, onStatus, onWorkstation }: Props) {
  const [reached, setReached] = useState(0);
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [auto, setAuto] = useState(false);
  const [finished, setFinished] = useState(false);
  const [absorb, setAbsorb] = useState<number | null>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLElement>(null);

  // Compute the newly reached stage, then open it.
  useEffect(() => {
    setBusy(true);
    const t = window.setTimeout(() => {
      setBusy(false);
      setOpen(reached);
    }, processMs);
    return () => window.clearTimeout(t);
  }, [reached, processMs]);

  // Auto mode: move on after the stage has played.
  useEffect(() => {
    if (!auto || open === null || open !== reached || finished || closing) return;
    const t = window.setTimeout(next, dwellMs);
    return () => window.clearTimeout(t);
  });

  // Zoom the stage out of its node.
  useLayoutEffect(() => {
    if (open !== null) zoom(open, "in");
  }, [open]);

  function zoom(i: number, dir: "in" | "out") {
    const el = panel.current;
    const n = nodes.current[i];
    if (!el || !n || typeof el.animate !== "function" || reducedMotion()) return;
    const a = el.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    const small = {
      transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})`,
      opacity: 0.15, filter: "blur(4px) brightness(2)",
    };
    const big = { transform: "none", opacity: 1, filter: "blur(0px) brightness(1)" };
    el.animate(dir === "in" ? [small, big] : [big, small], {
      duration: dir === "in" ? 650 : ZOOM_OUT_MS, easing: "cubic-bezier(.2,.8,.2,1)", fill: dir === "out" ? "forwards" : "none",
    });
  }

  function minimise(then: () => void) {
    if (open === null) return then();
    const i = open;
    zoom(i, "out");
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setOpen(null);
      setAbsorb(i);
      window.setTimeout(() => setAbsorb(null), 700);
      then();
    }, ZOOM_OUT_MS);
  }

  function next() {
    if (closing) return;
    if (open !== null && (open < reached || finished)) return minimise(() => (finished ? undefined : setOpen(reached)));
    if (reached === STAGES.length - 1) return minimise(() => { setFinished(true); setAuto(false); });
    minimise(() => setReached((r) => r + 1));
  }

  function expand(i: number) {
    if (closing || i === open) return;
    if (open === null) return setOpen(i);
    minimise(() => setOpen(i));
  }

  function restart() {
    setFinished(false);
    setOpen(null);
    setAuto(false);
    setReached(0);
  }

  const segs: SegState[] = STAGES.map((_, i) => (i < reached || finished ? "done" : i === reached && busy ? "flowing" : "idle"));
  const n = view.tile.coords.length.toLocaleString();
  const labels = ["", "image", `${n} patches`, `${n}×${view.encode.dim}`, `${n} scores`, `logit ${signed(view.aggregate.logit, 2)}`, "evidence"];
  const stage = open !== null ? STAGES[open] : null;
  const progress = finished ? 1 : (reached + (busy ? 0.5 : 1)) / STAGES.length;

  return (
    <div className="pf" data-testid="flow">
      <div className="pf__head">
        <div>
          <p className="eyebrow">Forward pass · {view.input.domain}</p>
          <h2>{view.input.title || view.caseId}</h2>
        </div>
        <div className="pf__actions">
          <button className="ghost" onClick={restart} data-testid="flow-restart">↺ Restart</button>
          <button className={auto ? "" : "ghost"} onClick={() => setAuto((a) => !a)} data-testid="flow-auto">
            {auto ? "❚❚ Pause" : "▶ Auto run"}
          </button>
          {onWorkstation && <button className="ghost" onClick={onWorkstation}>Workstation →</button>}
        </div>
      </div>

      <div className="pf-rail-wrap">
        <div className="pf-progress"><i style={{ width: `${progress * 100}%` }} /></div>
        <RailFlow nodes={nodes} states={segs} labels={labels} />
        <ol className="pf-rail" aria-label="pipeline">
          {STAGES.map((s, i) => {
            const state = i < reached || finished ? "done" : i === reached ? (busy ? "busy" : "active") : "idle";
            return (
              <li key={s.key} className="pf-rail__seg">
                <button
                  ref={(el) => { nodes.current[i] = el; }}
                  className={`node is-${state}${open === i ? " is-open" : ""}${absorb === i ? " is-absorb" : ""}`}
                  disabled={state === "idle" || state === "busy"}
                  onClick={() => expand(i)}
                  aria-label={`${s.title}${state === "done" ? " (expand)" : ""}`}
                  data-testid={`node-${s.key}`}
                >
                  <span className="node__led" />
                  {state === "done" && open !== i && <span className="node__plus" aria-hidden>+</span>}
                  <span className="node__preview"><Mini stage={s.key} view={view} /></span>
                  <span className="node__num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="node__title">{s.title}</span>
                  <span className="node__sub">{s.sub}</span>
                  {state === "busy" && <span className="node__spin" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="theatre">
        {stage && open !== null ? (
          <section ref={panel} key={open} className="stage hud-panel" aria-label={stage.title} data-testid={`pop-${stage.key}`}>
            <header className="stage__head">
              <span className="stage__num">{String(open + 1).padStart(2, "0")}</span>
              <div className="stage__title">
                <h3>{stage.title}</h3>
                <p>{EXPLAIN[stage.key]}</p>
              </div>
              <div className="stage__meta">
                {view.elapsedMs[stage.step] ? <span className="chip">{Math.round(view.elapsedMs[stage.step])} ms</span> : null}
                <span className="chip">stage {open + 1} / {STAGES.length}</span>
                <button className="icon" aria-label="minimise" onClick={next} title="Minimise into the pipeline">−</button>
              </div>
            </header>
            <div className="stage__body">
              <StageView stage={stage.key} view={view} patchUrl={patchUrl} onDecide={onDecide} onStatus={onStatus} />
            </div>
            <footer className="stage__foot">
              <span className="muted small">{auto && open === reached && !finished ? "Auto run: continuing shortly…" : "Finished stages dock on the pipeline; press + to reopen one."}</span>
              <div className="stage__btns">
                {open === reached && !finished && !auto && (
                  <button className="ghost" onClick={() => { setAuto(true); next(); }} data-testid="pop-auto">Auto run the rest</button>
                )}
                <button onClick={next} data-testid="pop-next" className="cta">
                  {open < reached || finished ? "Minimise" : open === STAGES.length - 1 ? "Finish ✓" : `Next: ${STAGES[open + 1].title} →`}
                </button>
              </div>
            </footer>
          </section>
        ) : finished ? (
          <Summary view={view} onOpen={expand} />
        ) : (
          <Console key={reached} index={reached} view={view} ms={processMs} />
        )}
      </div>
    </div>
  );
}

function StageView({ stage, view, patchUrl, onDecide, onStatus }: {
  stage: Stage; view: CaseView; patchUrl: (pid: number) => string | null;
  onDecide?: Props["onDecide"]; onStatus?: Props["onStatus"];
}) {
  switch (stage) {
    case "input": return <InputStage view={view} />;
    case "tile": return <TileStage view={view} />;
    case "encode": return <EncodeStage view={view} patchUrl={patchUrl} />;
    case "score": return <ScoreStage view={view} />;
    case "aggregate": return <AggregateStage view={view} />;
    case "explain": return <ExplainStage view={view} />;
    case "report": return <ReportStage view={view} onDecide={onDecide} onStatus={onStatus} />;
  }
}

/* ---------- compute console: what the pipeline is doing now, with the real numbers ---------- */

function consoleLines(stage: Stage, v: CaseView): string[] {
  const n = v.tile.coords.length.toLocaleString();
  const pos = v.evidence.patches.filter((p) => p.contribution > 0).length.toLocaleString();
  switch (stage) {
    case "input": return [`open specimen ${v.caseId}`, `preview ${v.input.imageSize[1]}×${v.input.imageSize[0]} px`, "ready for tiling"];
    case "tile": return [`grid ${v.tile.rows}×${v.tile.cols} patches${v.tile.tileUm ? ` of ${v.tile.tileUm} µm` : ""}`, "tissue mask: drop background tiles", `${n} tissue patches kept`];
    case "encode": return [`load ${v.encode.encoder.split(" (")[0]} (weights frozen)`, v.encode.cached ? "embeddings loaded from cache" : `encode ${n} patches in batches`, `bag = ${n} × ${v.encode.dim} matrix`];
    case "score": return ["additive head: s_i = a_i · (w · z_i)", `score ${n} instances`, `${pos} push toward tumour`];
    case "aggregate": return [`logit = Σ s_i + b = ${signed(v.aggregate.logit)}`, `calibrate with T = ${v.aggregate.temperature.toFixed(2)}`, `p = ${pct(v.aggregate.probability)}`];
    case "explain": return [`rank contributions · top-k = ${v.evidence.top_k.length}`, "deletion test: remove top patches, re-score", v.localisation ? "compare with pathologist outline" : "no outline for this case"];
    case "report": return ["draft report from evidence", "verifier: check every number and patch id", "queue for human sign-off"];
  }
}

function Console({ index, view, ms }: { index: number; view: CaseView; ms: number }) {
  const total = Math.max(0.05, ms / 1000);
  const t = useClock(total);
  const lines = consoleLines(STAGES[index].key, view);
  const per = total / (lines.length + 0.3);
  return (
    <div className="console hud-panel" data-testid="processing">
      <div className="console__orb" aria-hidden>
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" className="orb-a" />
          <circle cx="60" cy="60" r="40" className="orb-b" />
          <circle cx="60" cy="60" r="28" className="orb-c" />
        </svg>
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="console__log">
        <p className="eyebrow">Computing · {STAGES[index].title}</p>
        {lines.map((line, i) => {
          const start = i * per;
          if (t < start && t < total) return null;
          const typed = Math.ceil(((t - start) / (per * 0.7)) * line.length);
          const done = t >= start + per || t >= total;
          return (
            <div key={i} className="console__line">
              <span className={done ? "ok" : "console__cursor"}>{done ? "✓" : "›"}</span>
              <code>{done ? line : line.slice(0, Math.max(0, typed))}</code>
            </div>
          );
        })}
        <div className="console__bar"><i style={{ width: `${Math.min(100, (t / total) * 100)}%` }} /></div>
        <span className="muted small">please wait…</span>
      </div>
    </div>
  );
}

/* ---------- node previews ---------- */

function Mini({ stage, view }: { stage: Stage; view: CaseView }) {
  const top = view.evidence.top_k;
  switch (stage) {
    case "input": return <img src={view.input.thumbnail} alt="" />;
    case "tile": return <span className="mini-mosaic">{top.slice(0, 6).map((p) => <Crop key={p} view={view} pid={p} size={22} />)}</span>;
    case "encode": return <MiniScatter view={view} coloured={false} />;
    case "score": return <MiniScatter view={view} coloured />;
    case "aggregate": return <span className={`mini-prob tone-${verdict(view).tone}`}>{pct(view.aggregate.probability, 0)}</span>;
    case "explain": return <HeatGrid view={view} />;
    case "report": return <span className="mini-prob">{view.report?.status ?? "—"}</span>;
  }
}

function MiniScatter({ view, coloured }: { view: CaseView; coloured: boolean }) {
  const pts = view.encode.projection;
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(1, Math.floor(pts.length / 600));
  const keep = pts.map((p, i) => [p, i] as const).filter(([, i]) => i % step === 0);
  return (
    <svg viewBox="0 0 100 70" className="mini-scatter">
      {keep.map(([[x, y], i]) => {
        const c = view.evidence.patches[i]?.contribution ?? 0;
        return <circle key={i} cx={4 + ((x - x0) / (x1 - x0 || 1)) * 92} cy={66 - ((y - y0) / (y1 - y0 || 1)) * 62} r={1.4}
          fill={coloured ? (c >= 0 ? "#ff5c8a" : "#38bdf8") : "#5eead4"} opacity={0.8} />;
      })}
    </svg>
  );
}

function HeatGrid({ view }: { view: CaseView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const abs = view.evidence.patches.map((p) => Math.abs(p.contribution)).sort((a, b) => a - b);
    const scale = abs[Math.floor(abs.length * 0.99)] || 1;
    view.evidence.patches.forEach((p) => {
      const a = Math.min(Math.abs(p.contribution) / scale, 1);
      ctx.fillStyle = p.contribution >= 0 ? `rgba(255,92,138,${0.25 + a * 0.75})` : `rgba(56,189,248,${0.2 + a * 0.6})`;
      ctx.fillRect(p.col, p.row, 1, 1);
    });
  }, [view]);
  return <canvas ref={ref} className="heatgrid" width={view.tile.cols} height={view.tile.rows} />;
}

/* ---------- end of run ---------- */

function Summary({ view, onOpen }: { view: CaseView; onOpen: (i: number) => void }) {
  const v = verdict(view);
  const pos = view.evidence.patches.filter((p) => p.contribution > 0).length;
  const total = view.elapsedMs.reduce((a, b) => a + b, 0);
  return (
    <div className="summary hud-panel" data-testid="flow-done">
      <div className={`summary__ring tone-${v.tone}`}>
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" className="ring-track" />
          <circle cx="60" cy="60" r="50" className="ring-fill" pathLength={1} strokeDasharray={`${view.aggregate.probability} 1`} />
        </svg>
        <b>{pct(view.aggregate.probability)}</b>
      </div>
      <div className="summary__body">
        <p className="eyebrow">Run complete</p>
        <h3 className={`tone-${v.tone}`}>{v.label}</h3>
        <div className="stats stats--row">
          <div className="stat"><span>Patches</span><b>{view.evidence.patches.length.toLocaleString()}</b></div>
          <div className="stat"><span>Toward tumour</span><b className="tone-pos">{pos.toLocaleString()}</b></div>
          {view.localisation && <div className="stat"><span>Top-5 in outline</span><b>{pct(view.localisation.precision_at_5, 0)}</b></div>}
          <div className="stat"><span>Pipeline time</span><b>{(total / 1000).toFixed(1)} s</b></div>
        </div>
        <div className="summary__links">
          {STAGES.map((s, i) => <button key={s.key} className="ghost" onClick={() => onOpen(i)}>+ {s.title}</button>)}
        </div>
      </div>
    </div>
  );
}
