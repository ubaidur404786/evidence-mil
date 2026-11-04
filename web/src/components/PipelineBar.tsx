import { STEP_CAPTIONS, STEP_LABELS, STEPS } from "../types";

interface Props {
  index: number;
  playing: boolean;
  elapsedMs: number[];
  onGo: (i: number) => void;
  onToggle: () => void;
  onReplay: () => void;
}

/** Input → Tile → Encode → Aggregate → Explain → Report, animated, pausable, replayable. */
export function PipelineBar({ index, playing, elapsedMs, onGo, onToggle, onReplay }: Props) {
  const step = STEPS[index];
  return (
    <div className="pipeline">
      <div className="pipeline__controls">
        <button onClick={onToggle} data-testid="play-toggle">{playing ? "Pause" : "Play"}</button>
        <button className="ghost" onClick={onReplay} data-testid="replay">Replay</button>
      </div>
      <ol className="rail" aria-label="pipeline steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              className={`rail__step${i === index ? " is-current" : ""}${i < index ? " is-done" : ""}`}
              onClick={() => onGo(i)}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="rail__num">{i + 1}</span>
              <span>{STEP_LABELS[s]}</span>
              <span className="rail__ms">{elapsedMs[i] != null ? `${elapsedMs[i].toFixed(0)} ms` : ""}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="caption" data-testid="caption">
        <span data-testid={`step-${step}`}>{STEP_LABELS[step]}:</span> {STEP_CAPTIONS[step]}
      </p>
    </div>
  );
}
