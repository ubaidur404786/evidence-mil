import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pct, rankByContribution, signed, verdict } from "../lib/derive";
import type { CaseView, Report } from "../types";
import { ReportPanel } from "./ReportPanel";
import { SlideViewer } from "./SlideViewer";

/** The forward pass as a left-to-right pipeline: each stage processes, opens a popup, then docks onto the rail. */
const STAGES = [
  { key: "input", title: "Input", sub: "whole-slide image", busy: "Loading the image" },
  { key: "tile", title: "Patches", sub: "224 px tiles", busy: "Cutting the image into patches, dropping background" },
  { key: "encode", title: "Embeddings", sub: "768 numbers / patch", busy: "Encoding every patch with the frozen pathology model" },
  { key: "score", title: "Patch scores", sub: "one score per instance", busy: "Scoring every patch with the additive MIL head" },
  { key: "aggregate", title: "Slide score", sub: "Σ contributions", busy: "Adding up the patch evidence" },
  { key: "explain", title: "Explanation", sub: "where & why", busy: "Mapping the evidence back onto the slide" },
  { key: "report", title: "Report", sub: "verified, signed off", busy: "Drafting the report and verifying every number" },
] as const;
type Stage = (typeof STAGES)[number]["key"];

interface Props {
  view: CaseView;
  processMs?: number; // "please wait" animation per stage
  dwellMs?: number; // auto mode: time each popup stays open
  patchUrl: (pid: number) => string | null;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
  onStatus?: (status: Report["status"]) => void;
  onWorkstation?: () => void;
}

export function FlowRunner({ view, processMs = 1100, dwellMs = 4500, patchUrl, onDecide, onStatus, onWorkstation }: Props) {
  const [reached, setReached] = useState(0); // furthest stage started
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [auto, setAuto] = useState(false);
  const [finished, setFinished] = useState(false);
  const timer = useRef<number>();

  // Process the newly reached stage, then pop it up.
  useEffect(() => {
    setBusy(true);
    timer.current = window.setTimeout(() => {
      setBusy(false);
      setOpen(reached);
    }, processMs);
    return () => window.clearTimeout(timer.current);
  }, [reached, processMs]);

  // Auto mode: advance after the popup has been on screen for a while.
  useEffect(() => {
    if (!auto || open === null || open !== reached || finished) return;
    const t = window.setTimeout(next, dwellMs);
    return () => window.clearTimeout(t);
  });

  function dock(then: () => void) {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setOpen(null);
      then();
    }, 320);
  }

  function next() {
    if (open !== null && open < reached) return dock(() => setOpen(reached)); // back to the live stage
    if (reached === STAGES.length - 1) return dock(() => { setFinished(true); setAuto(false); });
    dock(() => setReached((r) => r + 1));
  }

  function restart() {
    setFinished(false);
    setOpen(null);
    setAuto(false);
    setReached(0);
  }

  const stage = open !== null ? STAGES[open] : null;
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
            {auto ? "❚❚ Pause auto" : "▶ Auto run"}
          </button>
          {onWorkstation && <button className="ghost" onClick={onWorkstation}>Open workstation →</button>}
        </div>
      </div>

      <ol className="pf-rail" aria-label="pipeline">
        {STAGES.map((s, i) => {
          const state = i < reached || finished ? "done" : i === reached ? (busy ? "busy" : "active") : "idle";
          return (
            <li key={s.key} className={`pf-rail__seg is-${state}`}>
              {i > 0 && <span className={`pipe is-${i < reached || finished ? "full" : i === reached ? "flowing" : "empty"}`} aria-hidden><i /></span>}
              <button
                className={`node is-${state}${open === i ? " is-open" : ""}`}
                disabled={state === "idle" || state === "busy"}
                onClick={() => setOpen(i)}
                data-testid={`node-${s.key}`}
              >
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

      {busy && !finished && (
        <div className="processing" data-testid="processing">
          <span className="processing__ring" aria-hidden />
          <span>{STAGES[reached].busy}… please wait</span>
        </div>
      )}

      {finished && open === null && <Summary view={view} onReview={() => setOpen(STAGES.length - 1)} />}

      {stage && open !== null && (
        <div className={`pop${closing ? " is-closing" : ""}`} role="dialog" aria-label={stage.title} data-testid={`pop-${stage.key}`}>
          <div className="pop__card" style={{ "--from": `${(open + 0.5) / STAGES.length * 100}%` } as CSSProperties}>
            <header className="pop__head">
              <span className="pop__num">{String(open + 1).padStart(2, "0")}</span>
              <div>
                <h3>{stage.title}</h3>
                <p className="muted small">{EXPLAIN[stage.key]}</p>
              </div>
            </header>
            <div className="pop__body">
              <StageView stage={stage.key} view={view} patchUrl={patchUrl} onDecide={onDecide} onStatus={onStatus} />
            </div>
            <footer className="pop__foot">
              <span className="muted small">{view.elapsedMs[stepIndex(stage.key)] ? `computed in ${Math.round(view.elapsedMs[stepIndex(stage.key)])} ms` : ""}</span>
              <div className="pop__btns">
                {open === reached && !finished && (
                  <button className="ghost" onClick={() => { setAuto(true); next(); }} data-testid="pop-auto">Auto run the rest</button>
                )}
                <button onClick={next} data-testid="pop-next">
                  {open < reached || finished ? "Close" : open === STAGES.length - 1 ? "Finish" : `Next: ${STAGES[open + 1].title} →`}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

const EXPLAIN: Record<Stage, string> = {
  input: "A lymph-node slide (or an uploaded region). Far too big for one model pass, so we split it.",
  tile: "Background is dropped. Every tissue patch becomes one instance in the bag. Scroll through them.",
  encode: "A frozen, pretrained pathology model turns each patch into a 768-number vector. Similar tissue lands close together (2-D projection shown).",
  score: "The additive head gives every patch its own signed score: its exact share of the slide's logit. Positive pushes toward tumour.",
  aggregate: "Slide logit = sum of all patch contributions + bias, then calibrated into a probability. Inside the uncertainty band the system abstains.",
  explain: "The heatmap is the score itself, mapped back onto the slide. Remove the top patches and the probability falls.",
  report: "An agent drafts a report from the evidence; a verifier rejects any number or patch id not in it; a person signs off.",
};

function stepIndex(s: Stage): number {
  return { input: 0, tile: 1, encode: 2, score: 3, aggregate: 3, explain: 4, report: 5 }[s];
}

/* ---------- shared bits ---------- */

/** A patch cropped out of the slide thumbnail with CSS (cheap enough for thousands of tiles). */
export function Crop({ view, pid, size }: { view: CaseView; pid: number; size: number }) {
  const shipped = view.patchImages[String(pid)];
  if (shipped) return <img className="crop" src={shipped} alt={`patch ${pid}`} width={size} height={size} />;
  const [h, w] = view.input.imageSize;
  const { rows, cols, coords } = view.tile;
  const [r, c] = coords[pid] ?? [0, 0];
  const cw = w / cols;
  const ch = h / rows;
  const s = size / cw;
  return (
    <span
      className="crop"
      role="img"
      aria-label={`patch ${pid}`}
      style={{
        width: size, height: (ch / cw) * size,
        backgroundImage: `url(${view.input.thumbnail})`,
        backgroundSize: `${w * s}px ${h * s}px`,
        backgroundPosition: `${-c * cw * s}px ${-r * ch * s}px`,
      }}
    />
  );
}

function contribColour(v: number, scale: number): string {
  const a = Math.min(Math.abs(v) / (scale || 1), 1);
  return v >= 0 ? `rgba(255,92,138,${0.25 + a * 0.75})` : `rgba(56,189,248,${0.25 + a * 0.75})`;
}

function useScale(view: CaseView): number {
  return useMemo(() => {
    const abs = view.evidence.patches.map((p) => Math.abs(p.contribution)).sort((a, b) => a - b);
    return abs[Math.floor(abs.length * 0.99)] || abs[abs.length - 1] || 1;
  }, [view]);
}

/** Contribution map at grid resolution (one pixel per patch), scaled up by CSS. */
function HeatGrid({ view }: { view: CaseView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useScale(view);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    view.evidence.patches.forEach((p) => {
      ctx.fillStyle = contribColour(p.contribution, scale);
      ctx.fillRect(p.col, p.row, 1, 1);
    });
  }, [view, scale]);
  return <canvas ref={ref} className="heatgrid" width={view.tile.cols} height={view.tile.rows} />;
}

/* ---------- node previews on the rail ---------- */

function Mini({ stage, view }: { stage: Stage; view: CaseView }) {
  const top = view.evidence.top_k;
  switch (stage) {
    case "input":
      return <img src={view.input.thumbnail} alt="" />;
    case "tile":
      return <span className="mini-mosaic">{top.slice(0, 6).map((p) => <Crop key={p} view={view} pid={p} size={18} />)}</span>;
    case "encode":
      return <Scatter view={view} coloured={false} small />;
    case "score":
      return <Scatter view={view} coloured small />;
    case "aggregate":
      return <span className={`mini-prob tone-${verdict(view).tone}`}>{pct(view.aggregate.probability, 0)}</span>;
    case "explain":
      return <HeatGrid view={view} />;
    case "report":
      return <span className="mini-prob">{view.report?.status ?? "—"}</span>;
  }
}

/* ---------- stage popups ---------- */

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
    case "report": return view.report
      ? <ReportPanel report={view.report} onDecide={onDecide} onStatus={onStatus} />
      : <p className="muted">No report for this run.</p>;
  }
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return <div className="stat"><span>{k}</span><b>{v}</b></div>;
}

function InputStage({ view }: { view: CaseView }) {
  const [h, w] = view.input.imageSize;
  return (
    <div className="stage-split">
      <div className="frame"><img src={view.input.thumbnail} alt="input slide" /></div>
      <div className="stats">
        <Stat k="Source" v={view.input.source || "—"} />
        <Stat k="Preview size" v={`${w} × ${h} px`} />
        <Stat k="Grid" v={`${view.tile.rows} × ${view.tile.cols}`} />
        {view.tile.tileUm && <Stat k="Patch size" v={`${view.tile.tileUm} µm`} />}
        {view.input.referenceLabel != null && <Stat k="Ground truth (hidden from model)" v={view.input.referenceLabel ? "tumour" : "normal"} />}
        {view.input.note && <p className="muted small">{view.input.note}</p>}
      </div>
    </div>
  );
}

const PAGE = 240;

function TileStage({ view }: { view: CaseView }) {
  const [shown, setShown] = useState(PAGE);
  const n = view.tile.coords.length;
  const total = view.tile.rows * view.tile.cols;
  return (
    <div className="stage-split">
      <div className="frame frame--grid">
        <SlideViewer image={view.input.thumbnail} imageSize={view.input.imageSize} rows={view.tile.rows} cols={view.tile.cols}
          coords={view.tile.coords} layer="grid" />
      </div>
      <div className="stage-col">
        <div className="stats stats--row">
          <Stat k="Tissue patches" v={n.toLocaleString()} />
          <Stat k="Background dropped" v={(total - n).toLocaleString()} />
        </div>
        <div className="patch-scroll" data-testid="patch-scroll">
          {view.tile.coords.slice(0, shown).map((_, pid) => (
            <figure key={pid} className="patch-chip" style={{ animationDelay: `${Math.min(pid, 60) * 12}ms` }}>
              <Crop view={view} pid={pid} size={64} />
              <figcaption>#{pid}</figcaption>
            </figure>
          ))}
          {shown < n && <button className="ghost more" onClick={() => setShown((s) => s + PAGE)}>Show more ({n - shown} left)</button>}
        </div>
      </div>
    </div>
  );
}

function Scatter({ view, coloured, small, onPick, picked }: {
  view: CaseView; coloured: boolean; small?: boolean; onPick?: (pid: number) => void; picked?: number | null;
}) {
  const scale = useScale(view);
  const pts = view.encode.projection;
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => 4 + ((x - x0) / (x1 - x0 || 1)) * 92;
  const sy = (y: number) => 96 - ((y - y0) / (y1 - y0 || 1)) * 92;
  const contrib = view.evidence.patches;
  return (
    <svg viewBox="0 0 100 100" className={`scatter${small ? " scatter--mini" : ""}`} data-testid={small ? undefined : "scatter"}>
      {pts.map(([x, y], i) => (
        <circle key={i} cx={sx(x)} cy={sy(y)} r={small ? 1.4 : picked === i ? 2.4 : 1.1}
          fill={coloured ? contribColour(contrib[i]?.contribution ?? 0, scale) : "rgba(94,234,212,0.75)"}
          stroke={picked === i ? "#fff" : "none"} strokeWidth={0.5}
          style={small ? undefined : { animationDelay: `${(i % 200) * 6}ms` }}
          onClick={onPick ? () => onPick(i) : undefined} />
      ))}
    </svg>
  );
}

function EncodeStage({ view, patchUrl }: { view: CaseView; patchUrl: (pid: number) => string | null }) {
  const [pid, setPid] = useState<number>(view.evidence.top_k[0] ?? 0);
  const big = patchUrl(pid);
  return (
    <div className="stage-split">
      <div className="frame frame--dark"><Scatter view={view} coloured={false} onPick={setPid} picked={pid} /></div>
      <div className="stage-col">
        <div className="encode-pipe">
          {big ? <img className="crop" src={big} alt={`patch ${pid}`} width={96} height={96} /> : <Crop view={view} pid={pid} size={96} />}
          <span className="encode-arrow">{view.encode.encoder} <i>→</i></span>
          <span className="vector" aria-label="embedding vector (schematic)">
            {Array.from({ length: 48 }, (_, k) => <i key={k} style={{ height: `${20 + ((pid * 37 + k * 53) % 80)}%` }} />)}
          </span>
        </div>
        <p className="muted small">Patch #{pid} → z ∈ ℝ<sup>{view.encode.dim}</sup>. Bars are schematic; the scatter is the real
          2-D projection of all {view.encode.projection.length.toLocaleString()} embeddings. Click a dot to pick a patch.</p>
        <div className="stats stats--row">
          <Stat k="Encoder" v={view.encode.encoder} />
          <Stat k="Dimensions" v={view.encode.dim} />
          <Stat k="Weights" v="frozen" />
        </div>
      </div>
    </div>
  );
}

function ScoreStage({ view }: { view: CaseView }) {
  const [order, setOrder] = useState<"top" | "bottom">("top");
  const [shown, setShown] = useState(80);
  const scale = useScale(view);
  const ranked = useMemo(() => {
    const r = rankByContribution(view.evidence);
    return order === "top" ? r : [...r].reverse();
  }, [view, order]);
  const byId = useMemo(() => new Map(view.evidence.patches.map((p) => [p.patch_id, p])), [view]);
  const pos = view.evidence.patches.filter((p) => p.contribution > 0).length;
  return (
    <div className="stage-split">
      <div className="frame frame--dark"><Scatter view={view} coloured /></div>
      <div className="stage-col">
        <div className="seg">
          <button className={order === "top" ? "" : "ghost"} onClick={() => setOrder("top")}>Most tumour-like</button>
          <button className={order === "bottom" ? "" : "ghost"} onClick={() => setOrder("bottom")}>Most normal-like</button>
          <span className="muted small">{pos} of {view.evidence.patches.length} push toward tumour</span>
        </div>
        <ul className="instances" data-testid="instances">
          {ranked.slice(0, shown).map((pid, i) => {
            const c = byId.get(pid)!.contribution;
            const width = Math.min(Math.abs(c) / scale, 1) * 50;
            return (
              <li key={pid} style={{ animationDelay: `${Math.min(i, 30) * 25}ms` }}>
                <Crop view={view} pid={pid} size={44} />
                <span className="inst__id">Patch #{pid}</span>
                <span className="inst__bar"><i className={c >= 0 ? "up" : "down"} style={{ width: `${width}%` }} /></span>
                <span className={`inst__val ${c >= 0 ? "tone-pos" : "tone-neg"}`}>{signed(c)}</span>
                <span className="inst__tag">{c >= 0 ? "→ tumour" : "→ normal"}</span>
              </li>
            );
          })}
        </ul>
        {shown < ranked.length && <button className="ghost more" onClick={() => setShown((s) => s + 120)}>Show more</button>}
      </div>
    </div>
  );
}

function Gauge({ p, band }: { p: number; band: [number, number] }) {
  const arc = (a: number, b: number) => {
    const pt = (t: number) => [50 - 40 * Math.cos(Math.PI * t), 52 - 40 * Math.sin(Math.PI * t)];
    const [x0, y0] = pt(a);
    const [x1, y1] = pt(b);
    return `M${x0},${y0} A40,40 0 0 1 ${x1},${y1}`;
  };
  return (
    <svg viewBox="0 0 100 60" className="gauge-arc" data-testid="gauge">
      <path d={arc(0, 1)} className="gauge-arc__track" />
      <path d={arc(band[0], band[1])} className="gauge-arc__band" />
      <path d={arc(0, Math.max(0.001, p))} className="gauge-arc__fill" />
      <text x="50" y="48" textAnchor="middle">{pct(p, 1)}</text>
    </svg>
  );
}

function AggregateStage({ view }: { view: CaseView }) {
  const ps = view.evidence.patches;
  const plus = ps.filter((p) => p.contribution > 0).reduce((s, p) => s + p.contribution, 0);
  const minus = ps.filter((p) => p.contribution < 0).reduce((s, p) => s + p.contribution, 0);
  const v = verdict(view);
  const a = view.aggregate;
  return (
    <div className="stage-split">
      <div className="sum">
        <div className="sum__row"><span>Σ positive patches</span><b className="tone-pos">{signed(plus)}</b></div>
        <div className="sum__row"><span>Σ negative patches</span><b className="tone-neg">{signed(minus)}</b></div>
        <div className="sum__row"><span>bias</span><b>{signed(a.bias)}</b></div>
        <div className="sum__row sum__total"><span>slide logit</span><b data-testid="flow-logit">{signed(a.logit)}</b></div>
        <div className="sum__row"><span>temperature</span><b>{a.temperature.toFixed(2)}</b></div>
        <p className="muted small">probability = σ(logit / T). The model is {a.head}; nothing else enters the score.</p>
      </div>
      <div className="stage-col center">
        <Gauge p={a.probability} band={a.band} />
        <p className={`verdict tone-${v.tone}`} data-testid="flow-verdict">{v.label}</p>
        <p className="muted small">Uncertainty band {pct(a.band[0], 0)}–{pct(a.band[1], 0)}: inside it the case is referred, not guessed.</p>
      </div>
    </div>
  );
}

function ExplainStage({ view }: { view: CaseView }) {
  const [overlay, setOverlay] = useState(Boolean(view.input.overlay));
  const values = useMemo(() => view.evidence.patches.map((p) => p.contribution), [view]);
  const curve = view.evidence.deletion_curve;
  const loc = view.localisation;
  const maxR = Math.max(1, ...curve.map((c) => c.removed));
  const path = curve.map((c, i) => `${i ? "L" : "M"}${(c.removed / maxR) * 100},${40 - c.probability * 38}`).join(" ");
  return (
    <div className="stage-split">
      <div className="frame frame--grid">
        <SlideViewer image={view.input.thumbnail} imageSize={view.input.imageSize} rows={view.tile.rows} cols={view.tile.cols}
          coords={view.tile.coords} layer="contribution" values={values} overlay={view.input.overlay}
          showOverlay={overlay} highlight={view.evidence.top_k.slice(0, 5)} />
      </div>
      <div className="stage-col">
        {view.input.overlay && (
          <label className="check"><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            Show pathologist outline</label>
        )}
        <div className="legend-row"><i className="sw sw--pos" /> pushes toward tumour <i className="sw sw--neg" /> toward normal</div>
        <div className="top-row">
          {view.evidence.top_k.slice(0, 5).map((pid, i) => (
            <figure key={pid} className="patch-chip"><Crop view={view} pid={pid} size={64} /><figcaption>#{i + 1}</figcaption></figure>
          ))}
        </div>
        <div className="card-dark">
          <h4>Deletion test</h4>
          <svg viewBox="0 0 100 42" className="curve-mini"><path d={path} /></svg>
          <p className="muted small">Remove the top patches one by one: probability {pct(curve[0]?.probability ?? 0, 0)} →{" "}
            {pct(curve[curve.length - 1]?.probability ?? 0, 0)}.</p>
        </div>
        {loc && (
          <div className="stats stats--row" data-testid="flow-localisation">
            <Stat k="Top-5 inside outline" v={pct(loc.precision_at_5, 0)} />
            <Stat k="Chance" v={pct(loc.chance, 0)} />
            <Stat k="AUROC" v={loc.auroc.toFixed(3)} />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ view, onReview }: { view: CaseView; onReview: () => void }) {
  const v = verdict(view);
  return (
    <div className="summary" data-testid="flow-done">
      <span className={`summary__dot tone-${v.tone}`} />
      <div>
        <b>Pipeline complete · {v.label}</b>
        <p className="muted small">P = {pct(view.aggregate.probability)} from {view.evidence.patches.length.toLocaleString()} patches.
          Click any node to revisit a stage.</p>
      </div>
      <button className="ghost" onClick={onReview}>Open report</button>
    </div>
  );
}
