import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { pct, rankByContribution, signed, verdict } from "../../lib/derive";
import type { CaseView, Report } from "../../types";
import { ReportPanel } from "../ReportPanel";
import { SlideViewer } from "../SlideViewer";
import {
  BLUE, CYAN, PINK, TEAL, clamp, easeInOut, easeOut, fit, lerp, phase, rgba, sample, useCanvas, useClock,
  useCountUp, useImage,
} from "./anim";

export const ZOOM_IN_S = 0.65; // stage choreography starts after the zoom-in

/* ---------------- shared ---------------- */

/** A patch cropped from the slide thumbnail with CSS (cheap for thousands of tiles). */
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
    <span className="crop" role="img" aria-label={`patch ${pid}`} style={{
      width: size, height: (ch / cw) * size, backgroundImage: `url(${view.input.thumbnail})`,
      backgroundSize: `${w * s}px ${h * s}px`, backgroundPosition: `${-c * cw * s}px ${-r * ch * s}px`,
    }} />
  );
}

export function useScale(view: CaseView): number {
  return useMemo(() => {
    const abs = view.evidence.patches.map((p) => Math.abs(p.contribution)).sort((a, b) => a - b);
    return abs[Math.floor(abs.length * 0.99)] || abs[abs.length - 1] || 1;
  }, [view]);
}

function Stat({ k, v, tone }: { k: string; v: string | number; tone?: string }) {
  return <div className="stat"><span>{k}</span><b className={tone}>{v}</b></div>;
}

function Count({ value, digits = 0, delay = ZOOM_IN_S, prefix = "", suffix = "" }: {
  value: number; digits?: number; delay?: number; prefix?: string; suffix?: string;
}) {
  const v = useCountUp(value, 1.3, delay);
  return <>{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}{suffix}</>;
}

/** Slide geometry in thumbnail pixels. */
function geom(view: CaseView) {
  const [h, w] = view.input.imageSize;
  return { W: w, H: h, cw: w / view.tile.cols, ch: h / view.tile.rows };
}

/** Scatter layout shared by the encode and score canvases (and their click picking). */
function scatterLayout(view: CaseView, x: number, y: number, w: number, h: number) {
  const pts = view.encode.projection;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([px, py]) => [
    x + 12 + ((px - x0) / (x1 - x0 || 1)) * (w - 24),
    y + h - 12 - ((py - y0) / (y1 - y0 || 1)) * (h - 24),
  ]);
}

function contribRGB(v: number, scale: number): [number[], number] {
  const a = clamp(Math.abs(v) / (scale || 1));
  if (a < 0.04) return [[139, 160, 187], 0.25]; // ~zero: neither direction
  return [v >= 0 ? PINK : BLUE, 0.3 + a * 0.7];
}

/* ---------------- 01 input ---------------- */

export function InputStage({ view }: { view: CaseView }) {
  const [h, w] = view.input.imageSize;
  return (
    <div className="stage-split">
      <div className="frame hud scan">
        <img src={view.input.thumbnail} alt="input slide" />
        <span className="hud__tag">SPECIMEN · {view.caseId}</span>
      </div>
      <div className="stage-col">
        <div className="stats stats--row">
          <Stat k="Preview" v={`${w} × ${h}`} />
          <Stat k="Patch grid" v={`${view.tile.rows} × ${view.tile.cols}`} />
          {view.tile.tileUm && <Stat k="Patch size" v={`${view.tile.tileUm} µm`} />}
          {view.input.referenceLabel != null && (
            <Stat k="Ground truth · hidden from model" v={view.input.referenceLabel ? "tumour" : "normal"}
              tone={view.input.referenceLabel ? "tone-pos" : "tone-neg"} />
          )}
        </div>
        <p className="lede">A whole-slide image is gigapixels: far too big for one model pass. EvidenceMIL treats it as a
          <b> bag of small patches</b> and asks which of them carry the evidence.</p>
        <p className="muted small">Source: {view.input.source || "—"}. {view.input.note}</p>
      </div>
    </div>
  );
}

/* ---------------- 02 tile ---------------- */

const FLY = 28;

export function TileStage({ view }: { view: CaseView }) {
  const img = useImage(view.input.thumbnail);
  const n = view.tile.coords.length;
  const total = view.tile.rows * view.tile.cols;
  const flyers = useMemo(() => sample(n, FLY), [n]);
  const masked = useMemo(() => {
    if (!img || typeof document === "undefined") return null;
    const { W, H, cw, ch } = geom(view);
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const o = off.getContext("2d");
    if (!o) return null;
    o.fillStyle = "rgba(2,6,12,0.78)";
    o.fillRect(0, 0, W, H);
    o.strokeStyle = rgba(CYAN, 0.55);
    o.lineWidth = Math.max(0.6, cw * 0.06);
    view.tile.coords.forEach(([r, c]) => {
      o.clearRect(c * cw, r * ch, cw, ch);
      o.strokeRect(c * cw, r * ch, cw, ch);
    });
    return off;
  }, [img, view]);

  const { ref } = useCanvas((ctx, t, w, h) => {
    if (!img) return true;
    const { W, H, cw, ch } = geom(view);
    const box = fit(W, H, 8, 8, w * 0.74 - 16, h - 16);
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
    // 1) grid sweeps across
    const g = phase(t, 0.1, 1.1);
    ctx.strokeStyle = rgba(CYAN, 0.35 * (1 - phase(t, 1.3, 0.6)) + 0.05);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let c = 0; c <= view.tile.cols; c++) {
      const x = box.x + c * cw * box.s;
      if (c / view.tile.cols > g) break;
      ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h);
    }
    for (let r = 0; r <= view.tile.rows; r++) {
      if (r / view.tile.rows > g) break;
      const y = box.y + r * ch * box.s;
      ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y);
    }
    ctx.stroke();
    const sweepX = box.x + g * box.w;
    if (g > 0 && g < 1) {
      const sg = ctx.createLinearGradient(sweepX - 40, 0, sweepX, 0);
      sg.addColorStop(0, rgba(CYAN, 0)); sg.addColorStop(1, rgba(CYAN, 0.5));
      ctx.fillStyle = sg; ctx.fillRect(sweepX - 40, box.y, 40, box.h);
    }
    // 2) background drops away, tissue tiles light up
    const m = phase(t, 1.2, 0.8);
    if (masked && m > 0) {
      ctx.globalAlpha = m;
      ctx.drawImage(masked, box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
    }
    // 3) a sample of patches lifts off the slide into the bag
    const colX = w * 0.76;
    const slot = Math.min(44, (h - 24) / 14, (w * 0.24 - 12) / 2);
    flyers.forEach((pid, i) => {
      const p = easeInOut(phase(t, 2.1 + i * 0.045, 0.9));
      if (p <= 0) return;
      const [r, c] = view.tile.coords[pid];
      const sx = box.x + c * cw * box.s;
      const sy = box.y + r * ch * box.s;
      const ss = cw * box.s;
      const tx = colX + (i % 2) * (slot + 6);
      const ty = 26 + Math.floor(i / 2) * (slot + 4);
      const x = lerp(sx, tx, p);
      const y = lerp(sy, ty, p) - Math.sin(p * Math.PI) * 30;
      const s = lerp(ss, slot, p);
      ctx.save();
      ctx.shadowColor = rgba(CYAN, 0.9);
      ctx.shadowBlur = 10 * (1 - p) + 4;
      ctx.drawImage(img, c * cw, r * ch, cw, ch, x, y, s, s * (ch / cw));
      ctx.restore();
      ctx.strokeStyle = rgba(CYAN, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, s, s * (ch / cw));
    });
    ctx.fillStyle = rgba(CYAN, 0.9);
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    if (t > 2.4) ctx.fillText("BAG OF PATCHES", colX, 16);
    return t < 4.2;
  }, ZOOM_IN_S);

  const [shown, setShown] = useState(240);
  return (
    <div className="stage-split stage-split--wide">
      <div className="canvas-frame hud"><canvas ref={ref} className="stage-canvas" /><span className="hud__tag">TILING · 224 px @ 20×</span></div>
      <div className="stage-col">
        <div className="stats stats--row">
          <Stat k="Tissue patches" v={n.toLocaleString()} tone="tone-accent" />
          <Stat k="Background dropped" v={(total - n).toLocaleString()} />
        </div>
        <div className="patch-scroll" data-testid="patch-scroll">
          {view.tile.coords.slice(0, shown).map((_, pid) => (
            <figure key={pid} className="patch-chip" style={{ animationDelay: `${2.6 + Math.min(pid, 60) * 0.015}s` }}>
              <Crop view={view} pid={pid} size={58} />
              <figcaption>#{pid}</figcaption>
            </figure>
          ))}
          {shown < n && <button className="ghost more" onClick={() => setShown((s) => s + 240)}>Show more ({(n - shown).toLocaleString()} left)</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 03 encode ---------------- */

function encodeLayout(w: number, h: number) {
  return { encX: w * 0.27, encW: w * 0.1, sx: w * 0.44, sw: w * 0.56 - 8, sy: 8, sh: h - 16 };
}

export function EncodeStage({ view, patchUrl }: { view: CaseView; patchUrl: (pid: number) => string | null }) {
  const img = useImage(view.input.thumbnail);
  const [pid, setPid] = useState<number>(view.evidence.top_k[0] ?? 0);
  const N = view.encode.projection.length;
  const stream = useMemo(() => sample(view.tile.coords.length, 36), [view]);
  const EMIT = 3.2;

  const { ref, redraw } = useCanvas((ctx, t, w, h) => {
    const L = encodeLayout(w, h);
    const pts = scatterLayout(view, L.sx, L.sy, L.sw, L.sh);
    const { cw, ch } = geom(view);
    // incoming patches on a conveyor
    if (img) {
      stream.forEach((p, k) => {
        const q = phase(t, k * 0.09, 0.9);
        if (q <= 0 || q >= 1) return;
        const [r, c] = view.tile.coords[p];
        const s = 30;
        const lane = (k % 5) - 2;
        const x = lerp(-s, L.encX - s / 2, easeInOut(q));
        const y = h / 2 + lane * 38 * (1 - easeInOut(q)) - s / 2;
        ctx.globalAlpha = q > 0.85 ? (1 - q) / 0.15 : 1;
        ctx.drawImage(img, c * cw, r * ch, cw, ch, x, y, s, s);
        ctx.strokeStyle = rgba(CYAN, 0.7);
        ctx.strokeRect(x, y, s, s);
        ctx.globalAlpha = 1;
      });
    }
    // encoder: a stack of transformer blocks with a travelling activation wave
    const blocks = 12;
    const bh = (h * 0.62) / blocks;
    const top = h * 0.19;
    for (let b = 0; b < blocks; b++) {
      const wave = 0.5 + 0.5 * Math.sin(t * 6 - b * 0.7);
      const active = t < EMIT + 1 ? wave : 0.25;
      ctx.fillStyle = `rgba(34,211,238,${0.08 + active * 0.35})`;
      ctx.strokeStyle = rgba(CYAN, 0.35 + active * 0.5);
      ctx.beginPath();
      ctx.roundRect?.(L.encX, top + b * bh + 1, L.encW, bh - 3, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = rgba(CYAN, 0.95);
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(view.encode.encoder.split(" (")[0].toUpperCase(), L.encX + L.encW / 2, top - 18);
    ctx.fillStyle = "rgba(139,160,187,0.9)";
    ctx.fillText("ViT · frozen", L.encX + L.encW / 2, top - 6);
    ctx.textAlign = "left";
    // embeddings emerge and settle into the 2-D map
    const ex = L.encX + L.encW;
    const ey = h / 2;
    let emitted = 0;
    for (let i = 0; i < pts.length; i++) {
      const born = 0.7 + (i / N) * EMIT;
      const q = easeOut(phase(t, born, 0.8));
      if (q <= 0) continue;
      emitted++;
      const [px, py] = pts[i];
      const x = lerp(ex, px, q);
      const y = lerp(ey, py, q) + Math.sin(q * Math.PI) * ((i % 7) - 3) * 8;
      ctx.fillStyle = q < 1 ? rgba([220, 255, 255], 0.9) : rgba(TEAL, 0.75);
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
    // axes, counter, picked point
    ctx.strokeStyle = "rgba(94,164,255,0.25)";
    ctx.strokeRect(L.sx, L.sy, L.sw, L.sh);
    ctx.fillStyle = rgba(CYAN, 0.95);
    ctx.fillText(`z ∈ ℝ^${view.encode.dim} · encoded ${emitted.toLocaleString()} / ${N.toLocaleString()}`, L.sx + 8, L.sy + 16);
    ctx.fillStyle = "rgba(139,160,187,0.8)";
    ctx.fillText("2-D projection of the embeddings (display only)", L.sx + 8, L.sy + L.sh - 8);
    if (t > EMIT + 1.5 && pts[pid]) {
      const [x, y] = pts[pid];
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 6 + Math.sin(t * 4), 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
    return true;
  }, ZOOM_IN_S);

  function pick(e: MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const L = encodeLayout(r.width, r.height);
    const pts = scatterLayout(view, L.sx, L.sy, L.sw, L.sh);
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = 0;
    let bd = Infinity;
    pts.forEach(([px, py], i) => {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (bd < 400) { setPid(best); redraw(); }
  }

  const big = patchUrl(pid);
  return (
    <div className="stage-split stage-split--wide">
      <div className="canvas-frame hud"><canvas ref={ref} className="stage-canvas is-click" onClick={pick} data-testid="scatter" />
        <span className="hud__tag">ENCODER · {view.encode.cached ? "cached features" : "live"}</span></div>
      <div className="stage-col">
        <div className="encode-pipe">
          {big ? <img className="crop" src={big} alt={`patch ${pid}`} width={92} height={92} /> : <Crop view={view} pid={pid} size={92} />}
          <span className="encode-arrow">f<sub>θ</sub>(x) <i>→</i></span>
          <span className="vector" key={pid} aria-label="embedding vector (schematic)">
            {Array.from({ length: 40 }, (_, k) => <i key={k} style={{ height: `${18 + ((pid * 37 + k * 53) % 80)}%`, animationDelay: `${k * 12}ms` }} />)}
          </span>
        </div>
        <p className="muted small">Patch #{pid} → a vector of {view.encode.dim} numbers (bars are schematic). Every dot on the map is
          a real patch embedding; click one to pick it. Similar tissue lands close together.</p>
        <div className="stats stats--row">
          <Stat k="Encoder" v={view.encode.encoder.split(" (")[0]} />
          <Stat k="Vector size" v={view.encode.dim} />
          <Stat k="Training" v="frozen" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- 04 instance scores ---------------- */

export function ScoreStage({ view }: { view: CaseView }) {
  const scale = useScale(view);
  const [order, setOrder] = useState<"top" | "bottom">("top");
  const [shown, setShown] = useState(80);
  const ranked = useMemo(() => {
    const r = rankByContribution(view.evidence);
    return order === "top" ? r : [...r].reverse();
  }, [view, order]);
  const byId = useMemo(() => new Map(view.evidence.patches.map((p) => [p.patch_id, p])), [view]);
  const pos = view.evidence.patches.filter((p) => p.contribution > 0).length;
  const top = view.evidence.top_k.slice(0, 5);

  const { ref } = useCanvas((ctx, t, w, h) => {
    const hist = 54;
    const pts = scatterLayout(view, 8, 8, w - 16, h - hist - 24);
    const xs = pts.map((p) => p[0]);
    const minX = Math.min(...xs);
    const span = Math.max(...xs) - minX || 1;
    const sweep = phase(t, 0.2, 1.8);
    pts.forEach(([x, y], i) => {
      const c = byId.get(i)?.contribution ?? 0;
      const on = (x - minX) / span <= sweep;
      const [col, a] = contribRGB(c, scale);
      const big = on ? 1 + clamp(Math.abs(c) / scale) * 1.6 : 1;
      ctx.fillStyle = on ? rgba(col, a) : rgba(TEAL, 0.45);
      ctx.fillRect(x - big, y - big, big * 2, big * 2);
    });
    if (sweep > 0 && sweep < 1) {
      const sx = minX + sweep * span;
      ctx.strokeStyle = rgba(CYAN, 0.8);
      ctx.beginPath(); ctx.moveTo(sx, 8); ctx.lineTo(sx, h - hist - 16); ctx.stroke();
    }
    // the top-scoring patches get called out
    const lab = phase(t, 2.1, 0.5);
    if (lab > 0) {
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      top.forEach((pid, k) => {
        const p = pts[pid];
        if (!p) return;
        ctx.globalAlpha = lab;
        ctx.strokeStyle = "#fff";
        ctx.beginPath(); ctx.arc(p[0], p[1], 7 + Math.sin(t * 3 + k) * 1.5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillText(`#${k + 1}`, p[0] + 9, p[1] - 6);
        ctx.globalAlpha = 1;
      });
    }
    // histogram of contributions, building up
    const vals = view.evidence.patches.map((p) => p.contribution);
    const bins = 48;
    const counts = new Array(bins).fill(0);
    vals.forEach((v) => { counts[Math.min(bins - 1, Math.floor(((clamp(v / scale, -1, 1) + 1) / 2) * bins))]++; });
    const maxC = Math.max(...counts, 1);
    const hy = h - 12;
    const grow = easeOut(phase(t, 0.6, 1.4));
    const bw = (w - 16) / bins;
    counts.forEach((c, b) => {
      const bh = Math.sqrt(c / maxC) * hist * grow;
      ctx.fillStyle = b >= bins / 2 ? rgba(PINK, 0.85) : rgba(BLUE, 0.85);
      ctx.fillRect(8 + b * bw + 0.5, hy - bh, bw - 1, bh);
    });
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath(); ctx.moveTo(w / 2, hy - hist - 4); ctx.lineTo(w / 2, hy); ctx.stroke();
    ctx.fillStyle = "rgba(139,160,187,0.9)";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillText("← normal", 10, hy - hist);
    ctx.textAlign = "right";
    ctx.fillText("tumour →", w - 10, hy - hist);
    ctx.textAlign = "left";
    return true;
  }, ZOOM_IN_S);

  return (
    <div className="stage-split stage-split--wide">
      <div className="canvas-frame hud"><canvas ref={ref} className="stage-canvas" /><span className="hud__tag">ADDITIVE HEAD · s<sub>i</sub> = a<sub>i</sub>·(w·z<sub>i</sub>)</span></div>
      <div className="stage-col">
        <div className="seg">
          <button className={order === "top" ? "" : "ghost"} onClick={() => setOrder("top")}>Most tumour-like</button>
          <button className={order === "bottom" ? "" : "ghost"} onClick={() => setOrder("bottom")}>Most normal-like</button>
          <span className="muted small"><b className="tone-pos">{pos.toLocaleString()}</b> of {view.evidence.patches.length.toLocaleString()} push toward tumour</span>
        </div>
        <ul className="instances" data-testid="instances">
          {ranked.slice(0, shown).map((pid, i) => {
            const c = byId.get(pid)!.contribution;
            const width = Math.min(Math.abs(c) / scale, 1) * 50;
            return (
              <li key={`${order}-${pid}`} style={{ animationDelay: `${ZOOM_IN_S + Math.min(i, 24) * 0.04}s` }}>
                <span className="inst__rank">{i + 1}</span>
                <Crop view={view} pid={pid} size={40} />
                <span className="inst__id">Patch #{pid}</span>
                <span className="inst__bar"><i className={c >= 0 ? "up" : "down"} style={{ width: `${width}%`, animationDelay: `${ZOOM_IN_S + 0.2 + Math.min(i, 24) * 0.04}s` }} /></span>
                <span className={`inst__val ${c >= 0 ? "tone-pos" : "tone-neg"}`}>{signed(c)}</span>
                <span className={`inst__tag ${c >= 0 ? "is-pos" : "is-neg"}`}>{c >= 0 ? "tumour" : "normal"}</span>
              </li>
            );
          })}
        </ul>
        {shown < ranked.length && <button className="ghost more" onClick={() => setShown((s) => s + 120)}>Show more</button>}
        <p className="muted small">Each score is the patch's exact share of the slide logit, so the list is not a post-hoc guess.</p>
      </div>
    </div>
  );
}

/* ---------------- 05 aggregate ---------------- */

function Gauge({ p, band, delay }: { p: number; band: [number, number]; delay: number }) {
  const t = useClock(1.6, delay);
  const shown = p * easeInOut(t / 1.6);
  const arc = (a: number, b: number) => {
    const pt = (q: number) => [60 - 48 * Math.cos(Math.PI * q), 62 - 48 * Math.sin(Math.PI * q)];
    const [x0, y0] = pt(a);
    const [x1, y1] = pt(b);
    return `M${x0},${y0} A48,48 0 0 1 ${x1},${y1}`;
  };
  const ang = Math.PI * shown;
  return (
    <svg viewBox="0 0 120 76" className="gauge-arc" data-testid="gauge">
      {Array.from({ length: 21 }, (_, k) => {
        const a = (Math.PI * k) / 20;
        const r0 = k % 5 ? 53 : 51;
        return <line key={k} x1={60 - r0 * Math.cos(a)} y1={62 - r0 * Math.sin(a)} x2={60 - 56 * Math.cos(a)} y2={62 - 56 * Math.sin(a)} className="gauge-arc__tick" />;
      })}
      <path d={arc(0, 1)} className="gauge-arc__track" />
      <path d={arc(band[0], band[1])} className="gauge-arc__band" />
      <path d={arc(0, Math.max(0.001, shown))} className="gauge-arc__fill" />
      <line x1="60" y1="62" x2={60 - 40 * Math.cos(ang)} y2={62 - 40 * Math.sin(ang)} className="gauge-arc__needle" />
      <circle cx="60" cy="62" r="3" className="gauge-arc__hub" />
      <text x="60" y="52" textAnchor="middle">{pct(shown, 1)}</text>
      <text x="12" y="74" className="gauge-arc__lbl">0</text>
      <text x="108" y="74" textAnchor="end" className="gauge-arc__lbl">1</text>
    </svg>
  );
}

export function AggregateStage({ view }: { view: CaseView }) {
  const ps = view.evidence.patches;
  const plus = ps.filter((p) => p.contribution > 0).reduce((s, p) => s + p.contribution, 0);
  const minus = ps.filter((p) => p.contribution < 0).reduce((s, p) => s + p.contribution, 0);
  const a = view.aggregate;
  const v = verdict(view);
  const scale = useScale(view);
  const RUN = 2.6;

  const { ref } = useCanvas((ctx, t, w, h) => {
    const n = ps.length;
    const tapeH = 46;
    const scan = easeInOut(phase(t, 0.15, RUN));
    const k = Math.floor(scan * n);
    // tape: every patch contribution in slide order
    const bw = (w - 16) / n;
    for (let i = 0; i < n; i++) {
      const c = ps[i].contribution;
      const hgt = clamp(Math.abs(c) / scale) * (tapeH / 2 - 2);
      ctx.fillStyle = i < k ? rgba(c >= 0 ? PINK : BLUE, 0.95) : "rgba(94,164,255,0.25)";
      ctx.fillRect(8 + i * bw, 8 + tapeH / 2 - (c >= 0 ? hgt : 0), Math.max(bw, 0.6), Math.max(hgt, 0.5));
    }
    ctx.fillStyle = "rgba(139,160,187,0.9)";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillText("patch contributions, slide order", 10, tapeH + 18);
    // running total: the real partial sum, plus the bias at the end
    const cum: number[] = [];
    let s = 0;
    for (let i = 0; i < n; i++) { s += ps[i].contribution; cum.push(s); }
    const final = s + a.bias;
    const lo = Math.min(0, ...cum, final);
    const hi = Math.max(0, ...cum, final);
    const gy0 = tapeH + 48;
    const gh = h - gy0 - 22;
    const Y = (val: number) => gy0 + gh - ((val - lo) / (hi - lo || 1)) * gh;
    const X = (i: number) => 8 + (i / Math.max(1, n - 1)) * (w - 70);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(8, Y(0)); ctx.lineTo(w - 8, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText("0", w - 18, Y(0) - 4);
    ctx.beginPath();
    for (let i = 0; i < k; i++) (i ? ctx.lineTo(X(i), Y(cum[i])) : ctx.moveTo(X(i), Y(cum[i])));
    ctx.strokeStyle = rgba(CYAN, 1);
    ctx.lineWidth = 2;
    ctx.shadowColor = rgba(CYAN, 0.9);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    if (k > 0 && k < n) {
      const cx = X(k - 1);
      ctx.strokeStyle = rgba(CYAN, 0.6);
      ctx.beginPath(); ctx.moveTo(8 + (k / n) * (w - 16), 8); ctx.lineTo(8 + (k / n) * (w - 16), tapeH + 8); ctx.stroke();
      ctx.fillStyle = "#e9ffff";
      ctx.beginPath(); ctx.arc(cx, Y(cum[k - 1]), 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // bias step and final logit
    const b = phase(t, RUN + 0.3, 0.6);
    if (b > 0) {
      const xe = X(n - 1);
      const y1 = Y(cum[n - 1]);
      const y2 = lerp(y1, Y(final), easeOut(b));
      ctx.strokeStyle = rgba([251, 191, 36], 1);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xe, y1); ctx.lineTo(xe + 26, y1); ctx.lineTo(xe + 26, y2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = rgba([251, 191, 36], 1);
      ctx.fillText("+ bias", xe + 30, (y1 + y2) / 2 + 4);
      if (b >= 1) {
        ctx.fillStyle = "#fff";
        ctx.font = "700 12px 'JetBrains Mono', monospace";
        ctx.fillText(`logit ${signed(final)}`, Math.max(8, xe - 110), Y(final) + (final >= 0 ? -10 : 18));
      }
    }
    ctx.fillStyle = "rgba(139,160,187,0.9)";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillText("running total Σ s_i  (real partial sums)", 10, gy0 - 2);
    return t < RUN + 1.2;
  }, ZOOM_IN_S);

  const settle = ZOOM_IN_S + RUN + 0.9;
  return (
    <div className="stage-split stage-split--wide">
      <div className="canvas-frame hud"><canvas ref={ref} className="stage-canvas" /><span className="hud__tag">AGGREGATE · Σ</span></div>
      <div className="stage-col">
        <div className="sum">
          <div className="sum__row"><span>Σ positive patches</span><b className="tone-pos"><Count value={plus} digits={3} prefix="+" /></b></div>
          <div className="sum__row"><span>Σ negative patches</span><b className="tone-neg"><Count value={minus} digits={3} /></b></div>
          <div className="sum__row"><span>bias b</span><b>{signed(a.bias)}</b></div>
          <div className="sum__row sum__total"><span>slide logit</span><b data-testid="flow-logit">{signed(a.logit)}</b></div>
          <div className="eq">p = σ(logit / T) = σ({signed(a.logit, 2)} / {a.temperature.toFixed(2)})</div>
        </div>
        <div className="gauge-wrap">
          <Gauge p={a.probability} band={a.band} delay={settle} />
          <p className={`verdict tone-${v.tone} appear`} style={{ animationDelay: `${settle + 1.5}s` }} data-testid="flow-verdict">{v.label}</p>
          <p className="muted small">Amber band {pct(a.band[0], 0)}–{pct(a.band[1], 0)}: inside it the system abstains and refers the case.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 06 explain ---------------- */

export function ExplainStage({ view }: { view: CaseView }) {
  const [overlay, setOverlay] = useState(Boolean(view.input.overlay));
  const values = useMemo(() => view.evidence.patches.map((p) => p.contribution), [view]);
  const curve = view.evidence.deletion_curve;
  const loc = view.localisation;
  const top = view.evidence.top_k.slice(0, 5);
  const byId = useMemo(() => new Map(view.evidence.patches.map((p) => [p.patch_id, p])), [view]);
  const [r0, c0] = view.tile.coords[top[0]] ?? [0, 0];
  const origin = { "--ox": `${((c0 + 0.5) / view.tile.cols) * 100}%`, "--oy": `${((r0 + 0.5) / view.tile.rows) * 100}%` } as CSSProperties;
  const maxR = Math.max(1, ...curve.map((c) => c.removed));
  const path = curve.map((c, i) => `${i ? "L" : "M"}${4 + (c.removed / maxR) * 92},${44 - c.probability * 38}`).join(" ");
  return (
    <div className="stage-split stage-split--wide">
      <div className="frame frame--grid hud reveal" style={origin}>
        <SlideViewer image={view.input.thumbnail} imageSize={view.input.imageSize} rows={view.tile.rows} cols={view.tile.cols}
          coords={view.tile.coords} layer="contribution" values={values} overlay={view.input.overlay}
          showOverlay={overlay} highlight={top} />
        <span className="hud__tag">EVIDENCE MAP · exact contributions</span>
      </div>
      <div className="stage-col">
        <div className="legend-row">
          <i className="sw sw--pos" /> pushes toward tumour <i className="sw sw--neg" /> toward normal
          {view.input.overlay && (
            <label className="check"><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> pathologist outline</label>
          )}
        </div>
        <div className="top-row">
          {top.map((pid, i) => (
            <figure key={pid} className="lens" style={{ animationDelay: `${ZOOM_IN_S + 0.8 + i * 0.12}s` }}>
              <Crop view={view} pid={pid} size={78} />
              <figcaption><b>#{i + 1}</b> <span className="tone-pos">{signed(byId.get(pid)?.contribution ?? 0, 2)}</span></figcaption>
            </figure>
          ))}
        </div>
        <div className="card-dark">
          <h4>Deletion test <span className="muted small">remove top patches → probability</span></h4>
          <svg viewBox="0 0 100 48" className="curve-mini" preserveAspectRatio="none">
            <line x1="4" x2="96" y1={44 - 0.5 * 38} y2={44 - 0.5 * 38} className="curve-mini__half" />
            <path d={path} pathLength={1} />
          </svg>
          <p className="muted small">{pct(curve[0]?.probability ?? 0, 0)} with all patches → {pct(curve[curve.length - 1]?.probability ?? 0, 0)} after
            removing the top {maxR}. {(curve[curve.length - 1]?.probability ?? 0) > 0.9 ? "Strong slide: many patches carry tumour evidence." : ""}</p>
        </div>
        {loc && (
          <div className="stats stats--row" data-testid="flow-localisation">
            <Stat k="Top-5 inside outline" v={pct(loc.precision_at_5, 0)} tone="tone-accent" />
            <Stat k="By chance" v={pct(loc.chance, 0)} />
            <Stat k="Patch AUROC" v={loc.auroc.toFixed(3)} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 07 report ---------------- */

export function ReportStage({ view, onDecide, onStatus }: {
  view: CaseView;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
  onStatus?: (status: Report["status"]) => void;
}) {
  const r = view.report;
  if (!r) return <p className="muted">No report for this run.</p>;
  const ok = r.verifier.passed;
  const checks: [string, boolean][] = [
    ["Draft written from the evidence object only", true],
    ["Every number matches the evidence", ok],
    ["Every cited patch id exists", ok],
    [view.aggregate.abstain ? "Uncertain: abstained, referred to specialist" : "Outside the uncertainty band", true],
  ];
  return (
    <div className="stage-split">
      <div className="stage-col">
        <ol className="checks">
          {checks.map(([label, pass], i) => (
            <li key={label} className={pass ? "is-pass" : "is-fail"} style={{ animationDelay: `${ZOOM_IN_S + i * 0.35}s` }}>
              <span className="checks__dot">{pass ? "✓" : "✗"}</span>{label}
            </li>
          ))}
          <li className="is-wait" style={{ animationDelay: `${ZOOM_IN_S + checks.length * 0.35}s` }}>
            <span className="checks__dot">●</span>Awaiting a human reviewer's sign-off
          </li>
        </ol>
        {!ok && <p className="bad small">{r.verifier.errors.join("; ")}</p>}
      </div>
      <ReportPanel report={r} onDecide={onDecide} onStatus={onStatus} />
    </div>
  );
}

