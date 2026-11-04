import { usePlayer } from "../hooks/usePlayer";
import { AggregateStep, EncodeStep, ExplainStep, InputStep, TileStep } from "../steps/Steps";
import { ReportStep } from "../steps/ReportStep";
import { STEP_CAPTIONS, STEP_LABELS, STEPS, type Report, type StepEvent } from "../types";

interface Props {
  events: StepEvent[];
  intervalMs?: number;
  onDecide?: (action: "approve" | "edit", sections?: Report["sections"]) => Promise<Report>;
}

/** Input → Tile → Encode → Aggregate → Explain → Report; animated, pausable, replayable. */
export function StepPlayer({ events, intervalMs, onDecide }: Props) {
  const ordered = STEPS.map((s) => events.find((e) => e.step === s)).filter(Boolean) as StepEvent[];
  const { index, playing, replay, goTo, toggle } = usePlayer(ordered.length, intervalMs);
  const current = ordered[index];
  if (!current) return <p className="hint">Waiting for events…</p>;
  const shown = ordered.slice(0, index + 1);
  const step = current.step as (typeof STEPS)[number];

  return (
    <div className="player">
      <ol className="rail" aria-label="pipeline steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              className={`rail__step${i === index ? " is-current" : ""}${i < index ? " is-done" : ""}`}
              disabled={i >= ordered.length}
              onClick={() => goTo(i)}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="rail__num">{i + 1}</span>
              {STEP_LABELS[s]}
            </button>
          </li>
        ))}
      </ol>
      <div className="controls">
        <button onClick={toggle} data-testid="play-toggle">{playing ? "Pause" : "Play"}</button>
        <button className="ghost" onClick={() => goTo(index - 1)} disabled={index === 0}>◀ Back</button>
        <button className="ghost" onClick={() => goTo(index + 1)} disabled={index >= ordered.length - 1}>Next ▶</button>
        <button className="ghost" onClick={replay} data-testid="replay">Replay</button>
        <span className="elapsed">{current.elapsed_ms?.toFixed(1)} ms</span>
      </div>
      <p className="caption" data-testid="caption">{STEP_CAPTIONS[step]}</p>
      <div className="stage" key={step} data-testid={`step-${step}`}>
        {step === "input" && <InputStep events={shown} />}
        {step === "tile" && <TileStep events={shown} />}
        {step === "encode" && <EncodeStep events={shown} />}
        {step === "aggregate" && <AggregateStep events={shown} />}
        {step === "explain" && <ExplainStep events={shown} />}
        {step === "report" && <ReportStep events={shown} onDecide={onDecide} />}
      </div>
    </div>
  );
}
