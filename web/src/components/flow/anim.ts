import { useEffect, useRef, useState } from "react";

// Small animation toolkit: rAF clocks, canvas loops, easing. Everything degrades to the final frame when
// motion is reduced or the environment has no canvas / rAF (tests).

export const reducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const hasRaf = (): boolean => typeof requestAnimationFrame !== "undefined" && typeof performance !== "undefined";

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const easeOut = (x: number): number => 1 - (1 - clamp(x)) ** 3;
export const easeInOut = (x: number): number => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Progress of a phase that runs from `start` for `dur` seconds. */
export const phase = (t: number, start: number, dur: number): number => clamp((t - start) / dur);

/** Seconds since mount (after `delay`), re-rendering every frame until `until`. */
export function useClock(until: number, delay = 0): number {
  const instant = reducedMotion() || !hasRaf();
  const [t, setT] = useState(instant ? until : 0);
  useEffect(() => {
    if (instant) return;
    let raf = 0;
    const start = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const s = Math.max(0, (now - start) / 1000);
      setT(Math.min(s, until));
      if (s < until) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [until, delay, instant]);
  return t;
}

/** Count up to `value` over `dur` seconds. */
export function useCountUp(value: number, dur = 1.2, delay = 0): number {
  const t = useClock(dur, delay);
  return value * easeOut(t / dur);
}

export type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => boolean;

/**
 * Run `draw` every frame on a DPR-aware canvas sized to its CSS box. `draw` returns true while it still
 * animates; the loop then sleeps until `redraw()` or a resize. `t` keeps counting real seconds since mount.
 */
export function useCanvas(draw: Draw, delay = 0) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const kickRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || !hasRaf()) return;
    const still = reducedMotion();
    const start = performance.now() + delay * 1000;
    let w = 0;
    let h = 0;
    let raf = 0;
    const size = () => {
      // layout size, not getBoundingClientRect: the stage may be mid-zoom (scaled) when this runs
      const d = window.devicePixelRatio || 1;
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.max(1, Math.round(w * d));
      cv.height = Math.max(1, Math.round(h * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const frame = (now: number) => {
      raf = 0;
      const t = still ? 1e4 : Math.max(0, (now - start) / 1000);
      ctx.clearRect(0, 0, w, h);
      if (drawRef.current(ctx, t, w, h) && !still) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;
    size();
    kick();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { size(); kick(); }) : null;
    ro?.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [delay]);
  return { ref, redraw: () => kickRef.current() };
}

/** Load an image element (null until it is decoded). */
export function useImage(src: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src || typeof Image === "undefined") return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = src;
    return () => { im.onload = null; };
  }, [src]);
  return img;
}

/** Fit a w×h rectangle inside a box, centred. */
export function fit(w: number, h: number, bx: number, by: number, bw: number, bh: number) {
  const s = Math.min(bw / w, bh / h);
  return { x: bx + (bw - w * s) / 2, y: by + (bh - h * s) / 2, s, w: w * s, h: h * s };
}

/** Deterministic spread sample of k indices from 0..n-1. */
export function sample(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(Math.floor(((i * 0.618034) % 1) * n));
  return [...new Set(out)];
}

export const PINK = [255, 92, 138];
export const BLUE = [56, 189, 248];
export const TEAL = [94, 234, 212];
export const CYAN = [34, 211, 238];
export const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
