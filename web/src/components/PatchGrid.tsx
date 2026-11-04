import type { CSSProperties } from "react";

export interface Cell {
  row: number;
  col: number;
  /** -1..1; positive = towards "positive", rendered warm; negative cool. */
  value?: number;
  highlight?: boolean;
  dimmed?: boolean;
  label?: string;
}

interface Props {
  thumbnail: string;
  rows: number;
  cols: number;
  cells: Cell[];
  /** Cells reveal one by one with this stagger (ms); 0 = instantly. */
  staggerMs?: number;
  testId?: string;
}

function colour(v: number): string {
  const a = Math.min(Math.abs(v), 1) * 0.75;
  return v >= 0 ? `rgba(var(--warm), ${a})` : `rgba(var(--cool), ${a})`;
}

/** Thumbnail with an aligned grid overlay; used by Tile, Aggregate and Explain steps. */
export function PatchGrid({ thumbnail, rows, cols, cells, staggerMs = 0, testId }: Props) {
  const style: CSSProperties = {
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
  };
  return (
    <div className="patch-grid" data-testid={testId}>
      <img src={thumbnail} alt="case thumbnail" />
      <div className="patch-grid__overlay" style={style}>
        {cells.map((c, i) => (
          <div
            key={`${c.row}-${c.col}`}
            className={`cell${c.highlight ? " cell--hi" : ""}${c.dimmed ? " cell--dim" : ""}`}
            title={c.label}
            style={{
              gridRow: c.row + 1,
              gridColumn: c.col + 1,
              background: c.value === undefined ? undefined : colour(c.value),
              animationDelay: `${i * staggerMs}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
