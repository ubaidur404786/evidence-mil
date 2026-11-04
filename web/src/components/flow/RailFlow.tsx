import type { RefObject } from "react";
import { CYAN, TEAL, rgba, useCanvas } from "./anim";

export type SegState = "idle" | "flowing" | "done";

/**
 * Glowing tubes between the pipeline nodes with data particles moving through them. A flowing segment
 * (the stage being computed) carries a labelled payload packet; finished segments keep a slow ambient flow.
 */
export function RailFlow({ nodes, states, labels }: {
  nodes: RefObject<(HTMLElement | null)[]>;
  states: SegState[]; // states[i] = segment entering node i (index 0 unused)
  labels: string[]; // payload carried into node i
}) {
  const { ref } = useCanvas((ctx, t) => {
    const cv = ref.current;
    const els = nodes.current;
    if (!cv || !els) return true;
    const base = cv.getBoundingClientRect();
    for (let i = 1; i < els.length; i++) {
      const a = els[i - 1]?.getBoundingClientRect();
      const b = els[i]?.getBoundingClientRect();
      if (!a || !b) continue;
      const x0 = a.right - base.left + 2;
      const x1 = b.left - base.left - 2;
      const y = a.top + a.height / 2 - base.top;
      const len = x1 - x0;
      if (len < 4) continue;
      const st = states[i];
      // tube walls
      ctx.lineWidth = 1;
      ctx.strokeStyle = st === "idle" ? "rgba(94,164,255,0.18)" : "rgba(34,211,238,0.45)";
      ctx.beginPath();
      ctx.moveTo(x0, y - 4); ctx.lineTo(x1, y - 4);
      ctx.moveTo(x0, y + 4); ctx.lineTo(x1, y + 4);
      ctx.stroke();
      if (st === "idle") {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = "rgba(94,164,255,0.25)";
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // liquid core
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba(CYAN, st === "done" ? 0.35 : 0.6));
      g.addColorStop(1, rgba(TEAL, st === "done" ? 0.35 : 0.6));
      ctx.fillStyle = g;
      ctx.shadowColor = rgba(CYAN, 0.8);
      ctx.shadowBlur = st === "flowing" ? 14 : 6;
      ctx.fillRect(x0, y - 2, len, 4);
      // particles with short trails
      const n = st === "flowing" ? 9 : 3;
      const speed = st === "flowing" ? 0.9 : 0.22;
      for (let k = 0; k < n; k++) {
        const p = (t * speed + k / n) % 1;
        const px = x0 + p * len;
        const tr = ctx.createLinearGradient(px - 18, 0, px, 0);
        tr.addColorStop(0, rgba(CYAN, 0));
        tr.addColorStop(1, rgba([220, 255, 255], 0.95));
        ctx.fillStyle = tr;
        ctx.fillRect(px - 18, y - 1.2, 18, 2.4);
        ctx.beginPath();
        ctx.arc(px, y, st === "flowing" ? 2.4 : 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "#e9ffff";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      // payload packet riding the active tube
      if (st === "flowing" && labels[i]) {
        const p = (t * 0.45) % 1;
        const px = x0 + p * len;
        ctx.font = "600 10px 'JetBrains Mono', ui-monospace, monospace";
        const tw = ctx.measureText(labels[i]).width + 12;
        const bx = Math.min(Math.max(px - tw / 2, x0), x1 - tw);
        ctx.fillStyle = "rgba(4,16,30,0.92)";
        ctx.strokeStyle = rgba(CYAN, 0.9);
        ctx.beginPath();
        ctx.roundRect?.(bx, y - 24, tw, 16, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = rgba(CYAN, 1);
        ctx.fillText(labels[i], bx + 6, y - 12.5);
      }
    }
    return true; // ambient flow never stops
  });
  return <canvas ref={ref} className="pf-railflow" aria-hidden />;
}
