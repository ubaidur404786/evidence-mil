import { useMemo, useState } from "react";
import { PatchGrid, type Cell } from "../components/PatchGrid";
import type { Evidence, StepEvent } from "../types";

type P = Record<string, any>; // payloads are stage-specific; see docs/ARCHITECTURE.md §2

function byStep(events: StepEvent[], step: string): P {
  return (events.find((e) => e.step === step)?.payload ?? {}) as P;
}

export function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function InputStep({ events }: { events: StepEvent[] }) {
  const p = byStep(events, "input");
  return (
    <div className="step-body">
      <img className="thumb" src={p.thumbnail} alt="case thumbnail" />
      <dl className="facts">
        <dt>Case</dt>
        <dd>{events[0]?.case_id}</dd>
        <dt>Domain</dt>
        <dd>{p.domain || "—"}</dd>
        {p.title && (
          <>
            <dt>Note</dt>
            <dd>{p.title}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function TileStep({ events }: { events: StepEvent[] }) {
  const input = byStep(events, "input");
  const t = byStep(events, "tile");
  const cells: Cell[] = (t.coords ?? []).map(([row, col]: number[]) => ({ row, col }));
  return (
    <div className="step-body">
      <PatchGrid thumbnail={input.thumbnail} rows={t.rows} cols={t.cols} cells={cells} staggerMs={12} testId="tile-grid" />
      <dl className="facts">
        <dt>Grid</dt>
        <dd>
          {t.rows} × {t.cols}
        </dd>
        <dt>Patches kept</dt>
        <dd>{t.n_patches}</dd>
      </dl>
    </div>
  );
}

export function EncodeStep({ events }: { events: StepEvent[] }) {
  const e = events.find((x) => x.step === "encode");
  const p = (e?.payload ?? {}) as P;
  const pts: number[][] = p.projection ?? [];
  return (
    <div className="step-body">
      <svg className="scatter" viewBox="-1.1 -1.1 2.2 2.2" role="img" aria-label="patch embeddings, 2-D projection">
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={-y} r={0.03} style={{ animationDelay: `${i * 10}ms` }} />
        ))}
      </svg>
      <dl className="facts">
        <dt>Encoder</dt>
        <dd>{p.encoder} (frozen)</dd>
        <dt>Vector size</dt>
        <dd>{p.dim}</dd>
        <dt>Embeddings</dt>
        <dd>{e?.cached ? <span className="badge">cached</span> : "computed live"}</dd>
      </dl>
      <p className="hint">Each dot is one patch. Similar-looking patches land close together.</p>
    </div>
  );
}

export function AggregateStep({ events }: { events: StepEvent[] }) {
  const input = byStep(events, "input");
  const t = byStep(events, "tile");
  const a = byStep(events, "aggregate");
  const att: number[] = a.attention ?? [];
  const max = Math.max(...att, 1e-9);
  const cells: Cell[] = (t.coords ?? []).map(([row, col]: number[], i: number) => ({
    row,
    col,
    value: att[i] / max,
    label: `patch ${i}: attention ${pct(att[i])}`,
  }));
  return (
    <div className="step-body">
      <PatchGrid thumbnail={input.thumbnail} rows={t.rows} cols={t.cols} cells={cells} testId="attention-grid" />
      <div className="score">
        <div className="score__value" data-testid="probability">
          {pct(a.probability ?? 0)}
        </div>
        <div className="score__label">calibrated probability (T = {a.temperature})</div>
        <div className="gauge">
          <div className="gauge__band" style={{ left: pct(a.abstain_band?.[0] ?? 0.4), width: pct((a.abstain_band?.[1] ?? 0.6) - (a.abstain_band?.[0] ?? 0.4)) }} />
          <div className="gauge__needle" style={{ left: pct(a.probability ?? 0) }} />
        </div>
        {a.abstain ? (
          <span className="badge badge--warn" data-testid="abstain">
            Abstains: too uncertain to decide
          </span>
        ) : (
          <span className="hint">logit {a.logit} · grey band = abstain zone</span>
        )}
      </div>
    </div>
  );
}

export function ExplainStep({ events }: { events: StepEvent[] }) {
  const input = byStep(events, "input");
  const t = byStep(events, "tile");
  const ev = byStep(events, "explain").evidence as Evidence | undefined;
  const [removed, setRemoved] = useState(0);
  const order = useMemo(
    () => (ev ? [...ev.patches].sort((x, y) => y.contribution - x.contribution).map((p) => p.patch_id) : []),
    [ev],
  );
  if (!ev) return null;
  const maxAbs = Math.max(...ev.patches.map((p) => Math.abs(p.contribution)), 1e-9);
  const gone = new Set(order.slice(0, removed));
  const top = new Set(ev.top_k);
  const cells: Cell[] = ev.patches.map((p) => ({
    row: p.row,
    col: p.col,
    value: gone.has(p.patch_id) ? undefined : p.contribution / maxAbs,
    highlight: top.has(p.patch_id) && !gone.has(p.patch_id),
    dimmed: gone.has(p.patch_id),
    label: `patch ${p.patch_id}: ${p.contribution.toFixed(3)}`,
  }));
  const topSum = ev.top_k.reduce((s, id) => s + ev.patches[id].contribution, 0);
  const rest = ev.patches.reduce((s, p) => s + p.contribution, 0) - topSum;
  const rows = [
    ...ev.top_k.map((id) => ({ label: `patch ${id}`, value: ev.patches[id].contribution })),
    { label: "all other patches", value: rest },
    { label: "bias", value: ev.bias },
  ];
  const barMax = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  const curve = ev.deletion_curve;
  const point = curve[Math.min(removed, curve.length - 1)];
  return (
    <div className="step-body step-body--wide">
      <PatchGrid thumbnail={input.thumbnail} rows={t.rows} cols={t.cols} cells={cells} testId="contribution-grid" />
      <div className="explain">
        <h3>Why this score</h3>
        <table className="bars" data-testid="contribution-bars">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="bars__track">
                  <div
                    className={`bar ${r.value >= 0 ? "bar--pos" : "bar--neg"}`}
                    style={{ width: `${(Math.abs(r.value) / barMax) * 100}%` }}
                  />
                </td>
                <td className="num">{r.value >= 0 ? "+" : ""}{r.value.toFixed(3)}</td>
              </tr>
            ))}
            <tr className="bars__total">
              <td>= logit</td>
              <td />
              <td className="num" data-testid="logit-total">{(topSum + rest + ev.bias).toFixed(3)}</td>
            </tr>
          </tbody>
        </table>
        <h3>What if we remove the top patches?</h3>
        <input
          type="range"
          min={0}
          max={curve.length - 1}
          value={removed}
          aria-label="patches removed"
          onChange={(e) => setRemoved(Number(e.target.value))}
        />
        <p data-testid="whatif">
          Removed {point.removed} → probability <strong>{pct(point.probability)}</strong>
          {removed > 0 && <> (was {pct(curve[0].probability)})</>}
        </p>
      </div>
    </div>
  );
}
