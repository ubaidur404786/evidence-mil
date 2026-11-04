import { pct, rankByContribution, signed, verdict } from "../lib/derive";
import type { CaseView } from "../types";

export function ScoreCard({ view }: { view: CaseView }) {
  const a = view.aggregate;
  const v = verdict(view);
  return (
    <section className="card score">
      <header className="card__head">
        <h3>Model output</h3>
        <span className="muted">{a.head} head · T = {a.temperature.toFixed(2)}</span>
      </header>
      <div className="score__row">
        <div className="score__value" data-testid="probability">{pct(a.probability)}</div>
        <div className={`verdict verdict--${v.tone}`} data-testid={a.abstain ? "abstain" : "verdict"}>{v.label}</div>
      </div>
      <div className="gauge" aria-label="calibrated probability with abstain band">
        <div className="gauge__band" style={{ left: pct(a.band[0]), width: pct(a.band[1] - a.band[0]) }} />
        <div className="gauge__needle" style={{ left: pct(a.probability) }} />
      </div>
      <div className="gauge__legend"><span>0%</span><span>abstain band {pct(a.band[0], 0)}–{pct(a.band[1], 0)}</span><span>100%</span></div>
      {view.input.referenceLabel != null && (
        <p className="muted small">
          Reference label (dataset ground truth): <strong>{view.input.referenceLabel ? "positive" : "negative"}</strong>
        </p>
      )}
    </section>
  );
}

/** Contribution bars that add up exactly to the logit (the additive head's guarantee). */
export function Decomposition({ view }: { view: CaseView }) {
  const ev = view.evidence;
  const byId = new Map(ev.patches.map((p) => [p.patch_id, p]));
  const top = ev.top_k.map((id) => ({ label: `#${ev.top_k.indexOf(id) + 1}  patch ${id}`, value: byId.get(id)!.contribution }));
  const topSum = top.reduce((s, r) => s + r.value, 0);
  const total = ev.patches.reduce((s, p) => s + p.contribution, 0);
  const rows = [...top, { label: `other ${ev.patches.length - top.length} patches`, value: total - topSum }, { label: "bias", value: ev.bias }];
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <section className="card">
      <header className="card__head">
        <h3>Why this score</h3>
        <span className="muted">logit = Σ patch contributions + bias</span>
      </header>
      <table className="bars" data-testid="contribution-bars">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="bars__label">{r.label}</td>
              <td className="bars__track">
                <div className="bars__axis" />
                <div
                  className={`bar ${r.value >= 0 ? "bar--pos" : "bar--neg"}`}
                  style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value >= 0 ? "left" : "right"]: "50%" }}
                />
              </td>
              <td className="num">{signed(r.value)}</td>
            </tr>
          ))}
          <tr className="bars__total">
            <td>= logit</td>
            <td className="muted small">→ probability {pct(view.aggregate.probability)}</td>
            <td className="num" data-testid="logit-total">{(total + ev.bias).toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function PatchGallery({ view, patchUrl, onSelect, selected }: {
  view: CaseView;
  patchUrl: (pid: number) => string | null;
  onSelect: (pid: number) => void;
  selected: number | null;
}) {
  // Prefer the patches the backend shipped images for (same ranking, ties resolved server-side).
  const shipped = Object.keys(view.patchImages).map(Number)
    .sort((a, b) => view.evidence.patches[b].contribution - view.evidence.patches[a].contribution);
  const order = (shipped.length ? shipped : rankByContribution(view.evidence)).slice(0, 8);
  const ref = view.tile.reference;
  return (
    <section className="card">
      <header className="card__head">
        <h3>Top evidence patches</h3>
        <span className="muted">highest contribution first{ref ? " · ✓ = inside pathologist outline" : ""}</span>
      </header>
      <div className="gallery" data-testid="patch-gallery">
        {order.map((pid, rank) => {
          const src = view.patchImages[String(pid)] ?? patchUrl(pid);
          const p = view.evidence.patches[pid];
          return (
            <button key={pid} className={`tile${selected === pid ? " is-selected" : ""}`} onClick={() => onSelect(pid)}>
              {src ? <img src={src} alt={`patch ${pid}`} /> : <div className="tile__empty">no image</div>}
              <span className="tile__rank">{rank + 1}</span>
              {ref && ref[pid] >= 0.5 && <span className="tile__ok" title="inside annotated tumour">✓</span>}
              <span className="tile__val">{signed(p.contribution, 2)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WhatIf({ view, removed, onChange }: { view: CaseView; removed: number; onChange: (n: number) => void }) {
  const curve = view.evidence.deletion_curve;
  const point = curve[Math.min(removed, curve.length - 1)];
  const W = 280;
  const H = 90;
  const x = (i: number) => (i / Math.max(curve.length - 1, 1)) * (W - 20) + 10;
  const y = (p: number) => H - 10 - p * (H - 20);
  const path = curve.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c.probability).toFixed(1)}`).join(" ");
  const [lo, hi] = view.aggregate.band;
  return (
    <section className="card">
      <header className="card__head">
        <h3>What if the top patches were absent?</h3>
        <span className="muted">deletion test, model re-run live</span>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="curve" role="img" aria-label="probability as top patches are removed">
        <rect x={10} width={W - 20} y={y(hi)} height={y(lo) - y(hi)} className="curve__band" />
        <path d={path} className="curve__line" />
        {curve.map((c, i) => (
          <circle key={i} cx={x(i)} cy={y(c.probability)} r={i === removed ? 4 : 2} className={i === removed ? "curve__dot is-on" : "curve__dot"} />
        ))}
      </svg>
      <input type="range" min={0} max={curve.length - 1} value={removed} aria-label="patches removed"
        onChange={(e) => onChange(Number(e.target.value))} />
      <p data-testid="whatif">
        Removed {point.removed} → probability <strong>{pct(point.probability)}</strong>
        {removed > 0 && <span className="muted"> (was {pct(curve[0].probability)})</span>}
      </p>
    </section>
  );
}

export function LocalisationCard({ view }: { view: CaseView }) {
  const loc = view.localisation;
  if (!loc) return null;
  return (
    <section className="card" data-testid="localisation">
      <header className="card__head">
        <h3>Agreement with the pathologist</h3>
        <span className="muted">{loc.annotated_patches} of {view.evidence.patches.length} patches annotated tumour</span>
      </header>
      <div className="kpis">
        <div><strong>{pct(loc.precision_at_5, 0)}</strong><span>of top-5 patches inside outline</span></div>
        <div><strong>{pct(loc.chance, 0)}</strong><span>by chance</span></div>
        <div><strong>{loc.auroc.toFixed(2)}</strong><span>AUROC of patch ranking</span></div>
      </div>
    </section>
  );
}

export function PatchInspector({ view, pid, patchUrl }: { view: CaseView; pid: number | null; patchUrl: (pid: number) => string | null }) {
  if (pid == null) return <p className="muted pad">Click a tile on the slide or a patch in the gallery to inspect it.</p>;
  const p = view.evidence.patches[pid];
  const rank = rankByContribution(view.evidence).indexOf(pid) + 1;
  const src = view.patchImages[String(pid)] ?? patchUrl(pid);
  const ref = view.tile.reference?.[pid];
  return (
    <section className="card inspector" data-testid="patch-inspector">
      <header className="card__head"><h3>Patch {pid}</h3><span className="muted">row {p.row}, col {p.col}</span></header>
      {src ? <img className="inspector__img" src={src} alt={`patch ${pid}`} /> : <div className="tile__empty big">image available in live mode</div>}
      <dl className="facts">
        <dt>Contribution</dt><dd>{signed(p.contribution)}</dd>
        <dt>Rank</dt><dd>{rank} of {view.evidence.patches.length}</dd>
        <dt>Attention</dt><dd>{pct(p.attention, 2)}</dd>
        {ref != null && (<><dt>Annotated tumour</dt><dd>{pct(ref, 0)} of the patch</dd></>)}
        {view.tile.tileUm && (<><dt>Patch size</dt><dd>{view.tile.tileUm} µm</dd></>)}
      </dl>
    </section>
  );
}

export function EmbeddingScatter({ view }: { view: CaseView }) {
  const max = Math.max(...view.evidence.patches.map((p) => Math.abs(p.contribution)), 1e-9);
  return (
    <section className="card">
      <header className="card__head">
        <h3>Patch embeddings</h3>
        <span className="muted">{view.encode.encoder} · {view.encode.dim}-d · {view.encode.cached ? "cached" : "computed live"}</span>
      </header>
      <svg className="scatter" viewBox="-1.1 -1.1 2.2 2.2" role="img" aria-label="2-D projection of patch embeddings">
        {view.encode.projection.map(([x, y], i) => {
          const c = view.evidence.patches[i]?.contribution ?? 0;
          return <circle key={i} cx={x} cy={-y} r={0.025} className={c >= 0 ? "pos" : "neg"} style={{ opacity: 0.25 + 0.75 * Math.abs(c) / max }} />;
        })}
      </svg>
      <p className="muted small">Each dot is one patch (PCA of its vector), coloured by contribution. Similar tissue lands close together.</p>
    </section>
  );
}
