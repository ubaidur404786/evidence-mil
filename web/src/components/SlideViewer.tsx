import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";

export type Layer = "none" | "grid" | "attention" | "contribution";

export interface ViewerProps {
  image: string;
  imageSize: [number, number]; // [height, width] of the thumbnail
  rows: number;
  cols: number;
  coords: [number, number][];
  layer: Layer;
  values?: number[]; // per patch: attention (0..1) or contribution (signed)
  overlay?: string | null; // annotation RGBA image, same size as the thumbnail
  showOverlay?: boolean;
  highlight?: number[]; // top patches (numbered markers)
  hidden?: Set<number>; // patches removed by the what-if slider
  selected?: number | null;
  opacity?: number;
  onSelect?: (patchId: number) => void;
}

const WARM = [214, 69, 45];
const COOL = [44, 110, 180];
const SEQ = [244, 162, 34];

function colour(layer: Layer, v: number, scale: number): string | null {
  if (layer === "attention") {
    const a = Math.min(v / scale, 1);
    return a < 0.02 ? null : `rgba(${SEQ.join(",")},${0.15 + a * 0.75})`;
  }
  if (layer === "contribution") {
    const a = Math.min(Math.abs(v) / scale, 1);
    if (a < 0.02) return null;
    return `rgba(${(v >= 0 ? WARM : COOL).join(",")},${0.12 + a * 0.78})`;
  }
  return null;
}

/** Robust colour scale: 99th percentile of |values| so one outlier does not wash out the map. */
function robustScale(values: number[]): number {
  const abs = values.map(Math.abs).sort((a, b) => a - b);
  return abs[Math.floor(abs.length * 0.99)] || abs[abs.length - 1] || 1;
}

/** Slide image with a tile overlay; wheel to zoom, drag to pan, click a tile to inspect it. */
export function SlideViewer(props: ViewerProps) {
  const { image, imageSize, rows, cols, coords, layer, values, overlay, showOverlay, highlight = [],
    hidden, selected, opacity = 1, onSelect } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [h, w] = imageSize[0] ? imageSize : [rows * 16, cols * 16];
  const cw = w / cols;
  const ch = h / rows;

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return; // jsdom
    ctx.clearRect(0, 0, w, h);
    const scale = values && values.length ? robustScale(values) : 1;
    coords.forEach(([r, c], i) => {
      if (hidden?.has(i)) {
        ctx.fillStyle = "rgba(20,20,20,0.6)";
        ctx.fillRect(c * cw, r * ch, cw, ch);
        return;
      }
      if (layer === "grid") {
        ctx.strokeStyle = "rgba(30,120,200,0.9)";
        ctx.lineWidth = Math.max(0.5, Math.min(cw, ch) * 0.08);
        ctx.strokeRect(c * cw, r * ch, cw, ch);
      } else if (values && layer !== "none") {
        const fill = colour(layer, values[i] ?? 0, scale);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }
      }
    });
    // Top patches: a white ring with a dark edge and a rank number, sized to stay readable when zoomed out.
    const ring = Math.max(cw, ch, w / 120);
    highlight.forEach((pid, rank) => {
      if (hidden?.has(pid) || !coords[pid]) return;
      const [r, c] = coords[pid];
      const cx = c * cw + cw / 2;
      const cy = r * ch + ch / 2;
      const rad = ring * 0.85;
      ctx.lineWidth = Math.max(1.5, ring * 0.12);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.75, ring * 0.05);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, rad + ring * 0.09, 0, Math.PI * 2);
      ctx.stroke();
      const fs = Math.max(9, ring * 0.7);
      ctx.font = `600 ${fs}px system-ui`;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(cx + rad * 0.7, cy - rad - fs * 0.9, fs * 0.9, fs * 1.05);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(rank + 1), cx + rad * 0.7 + fs * 0.2, cy - rad);
    });
    if (selected != null && coords[selected]) {
      const [r, c] = coords[selected];
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = Math.max(1.5, ring * 0.2);
      ctx.strokeRect(c * cw, r * ch, cw, ch);
    }
  }, [coords, layer, values, highlight, hidden, selected, w, h, cw, ch]);

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(24, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
  }
  function onDown(e: PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  function onUp(e: PointerEvent) {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag || !onSelect) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const y = ((e.clientY - rect.top) / rect.height) * h;
    const r = Math.floor(y / ch);
    const c = Math.floor(x / cw);
    const pid = coords.findIndex(([rr, cc]) => rr === r && cc === c);
    if (pid >= 0) onSelect(pid);
  }

  return (
    <div className="viewer" onWheel={onWheel} data-testid="slide-viewer">
      <div className="viewer__tools">
        <button className="icon" aria-label="zoom in" onClick={() => setZoom((z) => Math.min(24, z * 1.5))}>+</button>
        <button className="icon" aria-label="zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
        <button className="icon" aria-label="fit" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⤢</button>
        <span className="viewer__zoom">{zoom.toFixed(1)}×</span>
      </div>
      <div
        className="viewer__stage"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, aspectRatio: `${w} / ${h}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <img src={image} alt="slide" draggable={false} />
        {overlay && showOverlay && <img className="viewer__annotation" src={overlay} alt="pathologist annotation" draggable={false} />}
        <canvas ref={canvas} width={w} height={h} style={{ opacity }} />
      </div>
    </div>
  );
}
