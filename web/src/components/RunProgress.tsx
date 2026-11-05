import { useEffect, useState } from "react";
import type { Source } from "../api";
import type { CaseSummary } from "../types";

/**
 * Shown while the API computes a run. The encoder state is real (polled from /packs); the elapsed time is
 * real; the stage list says what happens, in order, without inventing a percentage.
 */
export function RunProgress({ source, item }: { source: Source; item?: CaseSummary }) {
  const [secs, setSecs] = useState(0);
  const [ready, setReady] = useState<boolean | null>(null);
  const live = source.live && item?.uploaded;

  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const poll = async () => {
      try {
        const pack = (await source.listPacks()).find((p) => p.name === item?.pack);
        if (!stop) setReady(pack?.encoder_ready ?? null);
      } catch {
        /* keep the last state */
      }
    };
    poll();
    const t = window.setInterval(poll, 2000);
    return () => { stop = true; window.clearInterval(t); };
  }, [live, source, item?.pack]);

  const n = item?.n_patches;
  const steps: [string, "done" | "now" | "next"][] = live
    ? [
      [`Image received and tiled${n ? ` · ${n.toLocaleString()} tissue patches` : ""}`, "done"],
      [ready ? "Phikon encoder loaded on the GPU" : "Loading the Phikon encoder (first run only, about 1–2 min)", ready ? "done" : "now"],
      [`Encoding${n ? ` ${n.toLocaleString()}` : ""} patches into 768-number vectors and scoring them`, ready ? "now" : "next"],
      ["Building the explanation and drafting the verified report", "next"],
    ]
    : [
      ["Loading the case", "done"],
      ["Running the additive model and building the explanation", "now"],
      ["Drafting the verified report", "next"],
    ];

  return (
    <div className="console hud-panel runprog" data-testid="loading" role="status" aria-live="polite">
      <div className="console__orb" aria-hidden>
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" className="orb-a" />
          <circle cx="60" cy="60" r="40" className="orb-b" />
          <circle cx="60" cy="60" r="28" className="orb-c" />
        </svg>
        <span className="runprog__time">{fmt(secs)}</span>
      </div>
      <div className="console__log">
        <p className="eyebrow">Analysing {item?.title || item?.case_id || "case"}</p>
        {steps.map(([label, state]) => (
          <div key={label} className={`console__line is-${state}`}>
            <span className={state === "done" ? "ok" : state === "now" ? "console__cursor" : "muted"}>
              {state === "done" ? "✓" : state === "now" ? "›" : "·"}
            </span>
            <code>{label}</code>
          </div>
        ))}
        <div className="runprog__bar"><i /></div>
        <p className="muted small">
          {live && !ready && secs > 20
            ? "Still loading the model: this happens once per API start. Keep this tab open."
            : "The step-by-step pipeline opens as soon as the run is ready."}
          {secs > 240 && " Taking unusually long: check the API terminal for errors."}
        </p>
      </div>
    </div>
  );
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Turn an API / network error into what the user should do next. */
export function errorGuide(message: string): { title: string; tips: string[] } {
  const m = message.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("event stream failed") || m.startsWith("502") || m.startsWith("504"))
    return { title: "Cannot reach the API", tips: ["Is the API running? Start it with uvicorn on port 8000 (see Run locally).", "Then reload this page."] };
  if (m.includes("out of memory"))
    return { title: "The GPU ran out of memory", tips: ["Close other programs that use the GPU, then press Retry.", "Smaller images (fewer tissue patches) need less memory."] };
  if (m.startsWith("422"))
    return { title: "This image cannot be analysed", tips: ["Use an H&E tissue region at 20× (0.5 µm/px), PNG or JPEG.", "Max 8192 px per side and 1500 tissue patches: crop the region of interest.", "Images that are mostly background have no tissue patches to score."] };
  if (m.startsWith("413")) return { title: "File too large", tips: ["The limit is 64 MB. Save as JPEG or crop the region."] };
  if (m.startsWith("404")) return { title: "Case not found", tips: ["The API was restarted with different packs. Reload the page."] };
  return { title: "The analysis failed", tips: ["Press Retry. If it fails again, the API terminal shows the full error.", "The uploaded image is saved; you can open it again from the worklist."] };
}
