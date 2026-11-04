import { useEffect, useMemo, useState } from "react";
import { usePlayer } from "../hooks/usePlayer";
import { rankByContribution } from "../lib/derive";
import type { CaseView, Report, StepName } from "../types";
import { STEPS } from "../types";
import {
  Decomposition,
  EmbeddingScatter,
  LocalisationCard,
  PatchGallery,
  PatchInspector,
  ScoreCard,
  WhatIf,
} from "./EvidencePanels";
import { PipelineBar } from "./PipelineBar";
import { ReportPanel } from "./ReportPanel";
import { SlideViewer, type Layer } from "./SlideViewer";

type Tab = "evidence" | "patch" | "report" | "pipeline";

const STAGE_LAYER: Record<StepName, Layer> = {
  input: "none", tile: "grid", encode: "grid", aggregate: "attention", explain: "contribution", report: "contribution",
};
const STAGE_TAB: Record<StepName, Tab> = {
  input: "pipeline", tile: "pipeline", encode: "pipeline", aggregate: "evidence", explain: "evidence", report: "report",
};

interface Props {
  view: CaseView;
  intervalMs?: number;
  patchUrl: (pid: number) => string | null;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
  onStatus?: (status: Report["status"]) => void;
}

export function CaseWorkspace({ view, intervalMs = 1800, patchUrl, onDecide, onStatus }: Props) {
  const player = usePlayer(STEPS.length, intervalMs);
  const stage = STEPS[player.index];
  const [layer, setLayer] = useState<Layer>("none");
  const [tab, setTab] = useState<Tab>("pipeline");
  const [annotation, setAnnotation] = useState(true);
  const [opacity, setOpacity] = useState(0.85);
  const [removed, setRemoved] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  // While the pipeline plays, the viewer and side panel follow the current stage.
  useEffect(() => {
    setLayer(STAGE_LAYER[stage]);
    setTab(STAGE_TAB[stage]);
  }, [stage]);

  const order = useMemo(() => rankByContribution(view.evidence), [view]);
  const hidden = useMemo(() => new Set(order.slice(0, removed)), [order, removed]);
  const values = layer === "attention" ? view.aggregate.attention
    : view.evidence.patches.map((p) => p.contribution);
  const shownStage = player.index >= STEPS.indexOf("explain");

  function select(pid: number) {
    setSelected(pid);
    setTab("patch");
    player.setPlaying(false);
  }

  return (
    <div className="workspace">
      <div className="workspace__head">
        <div>
          <h2>{view.input.title || view.caseId}</h2>
          <p className="muted small">{view.input.domain} · {view.caseId}{view.input.note ? ` · ${view.input.note}` : ""}</p>
        </div>
        {view.input.source && <p className="muted small source">{view.input.source}</p>}
      </div>

      <PipelineBar index={player.index} playing={player.playing} elapsedMs={view.elapsedMs}
        onGo={player.goTo} onToggle={player.toggle} onReplay={() => { setRemoved(0); player.replay(); }} />

      <div className="workspace__body">
        <div className="workspace__viewer">
          <div className="layers" role="toolbar" aria-label="overlay layers">
            {(["none", "grid", "attention", "contribution"] as Layer[]).map((l) => (
              <button key={l} className={layer === l ? "is-on" : ""} onClick={() => { setLayer(l); player.setPlaying(false); }}
                disabled={(l === "attention" && player.index < 3) || (l === "contribution" && player.index < 4)}>
                {l === "none" ? "Image" : l === "grid" ? "Tiles" : l === "attention" ? "Attention" : "Contribution"}
              </button>
            ))}
            {view.input.overlay && (
              <label className="toggle"><input type="checkbox" checked={annotation} onChange={(e) => setAnnotation(e.target.checked)} /> Pathologist outline</label>
            )}
            <label className="toggle">Opacity <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
          </div>
          <SlideViewer
            image={view.input.thumbnail}
            imageSize={view.input.imageSize}
            rows={view.tile.rows}
            cols={view.tile.cols}
            coords={player.index >= 1 ? view.tile.coords : []}
            layer={layer}
            values={values}
            overlay={view.input.overlay}
            showOverlay={annotation}
            highlight={shownStage ? topEvidence(view) : []}
            hidden={shownStage ? hidden : undefined}
            selected={selected}
            opacity={opacity}
            onSelect={select}
          />
          <Legend layer={layer} />
        </div>

        <div className="workspace__side">
          <div className="tabs" role="tablist">
            {(["evidence", "patch", "report", "pipeline"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
                {t === "evidence" ? "Evidence" : t === "patch" ? "Patch" : t === "report" ? "Report" : "Pipeline"}
              </button>
            ))}
          </div>
          <div className="tabpanel">
            {tab === "evidence" && player.index >= 3 && (
              <>
                <ScoreCard view={view} />
                {player.index >= 4 && (
                  <>
                    <Decomposition view={view} />
                    <LocalisationCard view={view} />
                    <PatchGallery view={view} patchUrl={patchUrl} onSelect={select} selected={selected} />
                    <WhatIf view={view} removed={removed} onChange={setRemoved} />
                  </>
                )}
              </>
            )}
            {tab === "evidence" && player.index < 3 && <p className="muted pad">Evidence appears after the Aggregate step.</p>}
            {tab === "patch" && <PatchInspector view={view} pid={selected} patchUrl={patchUrl} />}
            {tab === "report" && (player.index >= 5
              ? <ReportPanel report={view.report} onDecide={onDecide} onCite={select} onStatus={onStatus} />
              : <p className="muted pad">The report is drafted in the last step.</p>)}
            {tab === "pipeline" && (
              <>
                <section className="card">
                  <header className="card__head"><h3>Input & tiling</h3></header>
                  <dl className="facts">
                    <dt>Tile grid</dt><dd>{view.tile.rows} × {view.tile.cols}</dd>
                    <dt>Tissue patches</dt><dd>{view.evidence.patches.length}</dd>
                    {view.tile.tileUm && (<><dt>Patch size</dt><dd>{view.tile.tileUm} µm</dd></>)}
                    <dt>Encoder</dt><dd>{view.encode.encoder} (frozen){view.encode.cached && <span className="chip">cached</span>}</dd>
                  </dl>
                </section>
                {player.index >= 2 && <EmbeddingScatter view={view} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top-k patches that actually carry evidence (skip near-zero contributions). */
function topEvidence(view: CaseView): number[] {
  const max = Math.max(...view.evidence.patches.map((p) => Math.abs(p.contribution)), 1e-9);
  return view.evidence.top_k.filter((id) => Math.abs(view.evidence.patches[id].contribution) > 0.02 * max);
}

function Legend({ layer }: { layer: Layer }) {
  if (layer === "contribution")
    return <div className="legend"><span className="legend__bar legend__bar--div" /><span>pushes towards negative</span><span>pushes towards positive</span></div>;
  if (layer === "attention")
    return <div className="legend"><span className="legend__bar legend__bar--seq" /><span>low attention</span><span>high attention</span></div>;
  return <div className="legend muted small">Scroll to zoom · drag to pan · click a tile to inspect it</div>;
}
